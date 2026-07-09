// Contract-facing data helpers for the All Aboard surface.
//
// These are the pure helpers the app.contract `use`s. The transit math lives in
// the shared model (imported unchanged). Live Snapback data (delays + the
// freshness marker) arrives as ARGUMENTS — the .contract's `query` bindings
// over the generated liveTrainStatus/feedState descriptors (LLP 0034 §6
// ownership row 3; Exact LLP 0284 §5.3) — so these helpers are genuinely
// pure-by-args for the live data. The store.mjs seam and its poll pump are
// gone: server push drives the bindings, and the bindings drive the derives.
//
// Device location is the one remaining piece of module state: it is a device
// capability (navigator.geolocation), not transport glue, so it lives here as
// explicit device glue behind `setDeviceLocation`. Location-reading helpers
// keep the ticking `nowMs` cache-buster so the 1s clock re-derives them (the
// clock is UI — countdowns tick — not transport).

import {
  PATTERNS,
  computePosition,
  getAdjacentStation as modelAdjacent,
  assumedDirection as modelAssumedDirection,
  directionTitle as modelDirectionTitle,
  estimateBikeMinutes,
  estimateDistanceMiles,
  estimateWalkMinutes,
  formatClockTime as modelFormatClockTime,
  formatCountdownMinutes as modelFormatCountdown,
  getDirectionBoard as modelDirectionBoard,
  getNearestStation,
  getSelectedStation as modelSelectedStation,
  getStationById,
  getStations as modelStations,
  getTrainRun as modelTrainRun,
  getUpcomingDepartures as modelUpcomingDepartures,
  searchStations as modelSearch,
  serviceColor as modelServiceColor,
  stationPhoto as modelStationPhoto,
  stationPhotoCredit as modelStationPhotoCredit,
} from '../../snapback/shared/model.mjs';
import { STATION_ART_SCENES } from '../../snapback/shared/station-art.gen.mjs';
const DEFAULT_LOCATION = { lat: 37.3894, lng: -122.0819 }; // Mountain View fallback

// --- Device location (device-capability glue, set by main.ts) -----------------

type LatLng = { lat: number; lng: number };
type RouteMode = 'walk' | 'bike';
type RouteStation = { id?: string; lat: number; lng: number };
type RouteEstimateArgs = {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  mode: RouteMode;
};
type RouteEstimateResult = {
  mode?: string;
  minutes?: number;
  distanceMiles?: number;
  source?: string;
  cacheTtlMs?: number;
  error?: string;
};

const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
let deviceLocation: LatLng | null = null;
let deviceLocationSource = 'default'; // 'device' | 'default' | 'denied' | 'unavailable'

// --- Maps-app preference (device-capability glue, like location) ---------------
//
// ENG-23795: which maps app the directions affordances open. The value lives
// here (not contract state) because the web glue both writes it (the Settings
// press cycles it, persisted to localStorage) and reads it (to build the URL a
// tap opens); the .contract renders it through `mapsAppLabel(nowMs)` so the 1s
// clock re-derives the label after a cycle. On native hosts without the glue
// the label stays on the platform default — a declared gap, not a fake toggle.

export type MapsApp = 'default' | 'apple' | 'google';
const MAPS_APPS: MapsApp[] = ['default', 'apple', 'google'];
let mapsApp: MapsApp = 'default';

export function getMapsApp(): MapsApp {
  return mapsApp;
}

export function setMapsApp(next: string | null): void {
  mapsApp = MAPS_APPS.includes(next as MapsApp) ? (next as MapsApp) : 'default';
}

export function cycleMapsApp(): MapsApp {
  mapsApp = MAPS_APPS[(MAPS_APPS.indexOf(mapsApp) + 1) % MAPS_APPS.length];
  return mapsApp;
}

export function mapsAppLabel(_tick?: number): string {
  if (mapsApp === 'apple') return 'Apple Maps';
  if (mapsApp === 'google') return 'Google Maps';
  return 'Platform default';
}

// City-level postal addresses for the copy-address action. The model has no
// street addresses; a "<name> Caltrain Station, <city>, CA" string is
// unambiguous for every maps app without inventing house numbers.
const STATION_CITIES: Record<string, string> = {
  'san-francisco': 'San Francisco',
  'twenty-second-st': 'San Francisco',
  'bayshore': 'San Francisco',
  'south-sf': 'South San Francisco',
  'san-bruno': 'San Bruno',
  'millbrae': 'Millbrae',
  'burlingame': 'Burlingame',
  'san-mateo': 'San Mateo',
  'hayward-park': 'San Mateo',
  'hillsdale': 'San Mateo',
  'belmont': 'Belmont',
  'san-carlos': 'San Carlos',
  'redwood-city': 'Redwood City',
  'menlo-park': 'Menlo Park',
  'palo-alto': 'Palo Alto',
  'california-ave': 'Palo Alto',
  'mountain-view': 'Mountain View',
  'sunnyvale': 'Sunnyvale',
  'lawrence': 'Sunnyvale',
  'santa-clara': 'Santa Clara',
  'san-jose': 'San Jose',
};

export function stationAddress(stationId: string): string {
  const station = getStationById(stationId);
  if (!station) return '';
  const city = STATION_CITIES[stationId] ?? '';
  return city ? `${station.name} Caltrain Station, ${city}, CA` : `${station.name} Caltrain Station, CA`;
}

// The URL a directions affordance opens, per resolved app. Apple's dirflg
// cycling flag degrades to a plain destination view on clients that predate
// it; Google's travelmode is first-class.
export function directionsUrl(stationId: string, app: 'apple' | 'google', mode: RouteMode): string {
  const station = getStationById(stationId);
  if (!station) return '';
  const dest = `${station.lat},${station.lng}`;
  if (app === 'google') {
    const travelmode = mode === 'bike' ? 'bicycling' : 'walking';
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${travelmode}`;
  }
  return `https://maps.apple.com/?daddr=${dest}&dirflg=${mode === 'bike' ? 'c' : 'w'}`;
}
let routeEstimateInvoker: ((args: RouteEstimateArgs) => Promise<RouteEstimateResult>) | null = null;
const routeCache = new Map<string, { estimate: RouteEstimateResult; storedAt: number }>();
const routeInFlight = new Set<string>();

export function setDeviceLocation(location: LatLng | null, source?: string): void {
  deviceLocation = location ?? null;
  deviceLocationSource = source ?? (location ? 'device' : 'default');
}

export function setRouteEstimateInvoker(invoker: ((args: RouteEstimateArgs) => Promise<RouteEstimateResult>) | null): void {
  routeEstimateInvoker = invoker;
  routeCache.clear();
  routeInFlight.clear();
}

// --- Backend attach state (board-first startup, ENG-23727) --------------------
//
// The board mounts before the backend attaches, so the surface needs an
// honest, non-blocking answer to "is this live yet?". main.ts writes the
// phase here (transport glue, like device location); the ticking nowMs clock
// re-derives the note, so the board reflects a phase change within a second.

type BackendState = 'connecting' | 'connected' | 'offline';
let backendState: BackendState = 'connecting';

export function setBackendState(next: BackendState): void {
  backendState = next;
}

// The small status affordance shown with the schedule board while the live
// bindings are still pending; empty once the backend is attached (the live
// arms own freshness from then on).
export function backendStatusNote(_tick?: number): string {
  switch (backendState) {
    case 'connected': return '';
    case 'offline': return 'Offline — showing scheduled departures';
    default: return 'Connecting for live updates…';
  }
}

// The `loading` arm renders the same DirectionBoard as the live arms; this is
// its stand-in for the not-yet-delivered liveTrainStatus rows.
export function emptyDelayRows(): DelayRow[] {
  return [];
}

// --- Location + station selection --------------------------------------------

export function getUserLocation(_tick?: number) {
  return deviceLocation ?? DEFAULT_LOCATION;
}

export function locationSource(_tick?: number): string {
  return deviceLocationSource;
}

// A friendly, on-card signal of whether the nearest station came from the device
// or a fallback — so a denied/dismissed permission prompt is legible, not silent.
// The denied line says what to do about it: once the user re-allows access (the
// hint press re-prompts; a site-settings flip fires the permission change event
// main.ts listens for), the board adopts the real location without a reload.
export function locationHint(_tick?: number): string {
  switch (deviceLocationSource) {
    case 'device': return '📍 Using your location';
    case 'denied': return 'Location blocked — allow location for this site, then tap here';
    case 'unavailable': return 'Location unavailable — showing a default stop';
    default: return 'Allow location for your nearest stop';
  }
}

// The sticky-footer location indicator (ENG-23795): the usual up-left
// navigation glyph, blue while the board is on the real device location and
// gray on any fallback.
export function locationIndicatorColor(_tick?: number): string {
  return deviceLocationSource === 'device' ? '#0A84FF' : '#9CA3AF';
}

export function getSelectedStation(stationId: string | null, _tick?: number) {
  return modelSelectedStation(stationId, getUserLocation());
}

export function getStations() {
  return modelStations();
}

export function searchStations(query: string, _tick?: number) {
  return modelSearch(query, getUserLocation());
}

export function adjacentStationId(stationId: string, delta: number): string {
  const next = modelAdjacent(stationId, delta);
  return next ? next.id : stationId;
}

export function stationPhoto(stationId: string): string {
  return modelStationPhoto(stationId) ?? '';
}

export function stationPhotoCredit(stationId: string): string {
  return modelStationPhotoCredit(stationId) ?? '';
}

// The hand-drawn header scene (ENG-23719). Each station has three original
// scenes (ENG-23684); the pick rotates by epoch day — day-of-epoch mod the
// scene count — so the whole app flips to the next scene at midnight UTC and
// the choice stays deterministic (no per-render randomness to break tests).
const DAY_MS = 24 * 60 * 60 * 1000;

export function stationArt(stationId: string, nowMs: number): string {
  const scenes = (STATION_ART_SCENES as Record<string, string[]>)[stationId] ?? [];
  if (scenes.length === 0) return '';
  const day = Math.max(0, Math.floor(nowMs / DAY_MS));
  return scenes[day % scenes.length] ?? '';
}

// --- Direction ----------------------------------------------------------------

export function assumedDirection(station: { orderIndex: number } | null): string {
  return modelAssumedDirection(station);
}

export function activeDirection(override: string | null, station: { orderIndex: number } | null): string {
  return override === 'north' || override === 'south' ? override : modelAssumedDirection(station);
}

export function oppositeDirection(direction: string): string {
  return direction === 'north' ? 'south' : 'north';
}

export function directionTitle(direction: string): string {
  return modelDirectionTitle(direction);
}

// --- Boards + trips (live delays arrive as liveTrainStatus rows) --------------

type DelayRow = { patternId: string; delaySeconds: number };
type FeedRow = { lastSource?: string };
type LiveDepartureRow = {
  _id?: string;
  departureId?: string;
  stationId: string;
  direction: string;
  service: string;
  patternId?: string;
  trainNumber?: string;
  headsign?: string;
  scheduledDepartureMs: number;
  predictedDepartureMs: number;
  delaySeconds?: number;
  status?: string;
};

const LIVE_FEED_SOURCE = '511-siri-stop-monitoring';
const DEPARTED_GRACE_MS = 60 * 1000;

// liveTrainStatus rows -> the patternId -> delaySeconds map the model expects.
function delaysFrom(delayRows: readonly DelayRow[] | null | undefined): Record<string, number> {
  const delays: Record<string, number> = {};
  for (const row of delayRows ?? []) delays[row.patternId] = row.delaySeconds;
  return delays;
}

function isLiveFeed(feedRows: readonly FeedRow[] | null | undefined): boolean {
  return (feedRows?.[0]?.lastSource ?? '') === LIVE_FEED_SOURCE;
}

function liveDepartureId(row: LiveDepartureRow): string {
  return `live:${row._id ?? row.departureId ?? `${row.stationId}:${row.predictedDepartureMs}:${row.trainNumber ?? ''}`}`;
}

function departureFromLiveRow(row: LiveDepartureRow) {
  return {
    id: liveDepartureId(row),
    source: '511-siri-stop-monitoring',
    patternId: row.patternId ?? '',
    direction: row.direction,
    service: row.service || 'Local',
    trainNumber: row.trainNumber || '',
    headsign: row.headsign || (row.direction === 'north' ? 'San Francisco' : 'San Jose Diridon'),
    stationId: row.stationId,
    scheduledDepartureMs: row.scheduledDepartureMs,
    predictedDepartureMs: row.predictedDepartureMs,
    delaySeconds: row.delaySeconds ?? 0,
  };
}

function liveDeparturesFor(stationId: string, direction: string, nowMs: number, departureRows: readonly LiveDepartureRow[] | null | undefined, limit: number) {
  return (departureRows ?? [])
    .filter((row) => row.stationId === stationId && row.direction === direction)
    .filter((row) => Number(row.predictedDepartureMs) > nowMs - DEPARTED_GRACE_MS)
    .sort((a, b) => Number(a.predictedDepartureMs) - Number(b.predictedDepartureMs))
    .slice(0, limit)
    .map(departureFromLiveRow);
}

export function getDirectionBoard(
  stationId: string,
  direction: string,
  nowMs: number,
  limit: number,
  delayRows: DelayRow[],
  departureRows: LiveDepartureRow[],
  feedRows: FeedRow[],
) {
  if (isLiveFeed(feedRows)) {
    const departures = liveDeparturesFor(stationId, direction, nowMs, departureRows, limit);
    return {
      direction,
      stationId,
      primary: departures[0] ?? null,
      secondary: departures.slice(1),
    };
  }
  return modelDirectionBoard(stationId, direction, nowMs, delaysFrom(delayRows), limit);
}

// The hero-selection board (ENG-23795 paging model): `heroOffset` walks the
// upcoming trains. The offset is clamped to the rows that exist, so an offset
// stranded by time passing (the selected train departs) degrades to the last
// remaining train. Alongside the hero the board carries:
//   - heroPrev/heroNext: the physically adjacent cards for the paging strip
//     (visible mid-gesture, exactly the native contiguous-page model);
//   - before: the sooner trains already paged past, in compact rows above the
//     hero, so paging to a later train never makes earlier trains vanish;
//   - rest: the trains after the hero.
// Every before/rest row carries its absolute offset (press = select that
// train) and a precomputed testId: the rows adjacent to the hero are
// 'train-prev'/'train-next', so the keyboard/gesture/native press paths keep
// one stable handle for "walk one train" now that the arrow buttons are gone.
export function boardTrains(
  stationId: string,
  direction: string,
  nowMs: number,
  heroOffset: number,
  delayRows: DelayRow[],
  departureRows: LiveDepartureRow[],
  feedRows: FeedRow[],
) {
  const wanted = Math.max(0, heroOffset ?? 0);
  const rows = isLiveFeed(feedRows)
    ? liveDeparturesFor(stationId, direction, nowMs, departureRows, wanted + 5)
    : modelUpcomingDepartures(stationId, direction, nowMs, delaysFrom(delayRows), wanted + 5);
  const offset = rows.length === 0 ? 0 : Math.min(wanted, rows.length - 1);
  const withMeta = (row: (typeof rows)[number], absolute: number) => ({
    ...row,
    offset: absolute,
    testId:
      absolute === offset - 1 ? 'train-prev' : absolute === offset + 1 ? 'train-next' : `train-at-${absolute}`,
  });
  const beforeStart = Math.max(0, offset - 2);
  return {
    hero: rows[offset] ?? null,
    heroPrev: offset > 0 ? rows[offset - 1] : null,
    heroNext: rows[offset + 1] ?? null,
    before: rows.slice(beforeStart, offset).map((row, i) => withMeta(row, beforeStart + i)),
    rest: rows.slice(offset + 1, offset + 4).map((row, i) => withMeta(row, offset + 1 + i)),
    hasPrev: offset > 0,
    hasNext: rows.length > offset + 1,
    offset,
  };
}

// The end-of-line hint for a stations-list row (ENG-23795): the next train in
// the active direction from that station, projected to its own final stop —
// "… San Francisco 8:42" — so "does this get me to SF, and when?" is
// answerable from the list without opening every stop.
export function terminalHint(
  stationId: string,
  direction: string,
  nowMs: number,
  delayRows: DelayRow[],
  departureRows: LiveDepartureRow[],
  feedRows: FeedRow[],
): string {
  const board = getDirectionBoard(stationId, direction, nowMs, 1, delayRows, departureRows, feedRows);
  const primary = board?.primary;
  if (!primary) return '';
  const run = getTrainRun(primary.id, nowMs, delayRows, departureRows);
  const last = run?.stops?.[run.stops.length - 1];
  if (!last) return '';
  return `… ${last.station.name} ${modelFormatClockTime(last.predictedTimeMs)}`;
}

// On-time / late marker for a departure (or a trip; both carry delaySeconds).
export function delayLabel(dep: { delaySeconds?: number } | null): string {
  if (!dep) return '';
  const s = dep.delaySeconds ?? 0;
  return s >= 45 ? `${Math.max(1, Math.round(s / 60))} min late` : 'on time';
}

// Darker on-time/late hues than the old dark-board palette: these sit on the
// white board now (ENG-23719) and the light tints failed contrast there.
export function delayColor(dep: { delaySeconds?: number } | null): string {
  return (dep?.delaySeconds ?? 0) >= 45 ? '#B45309' : '#047857';
}

// Compact destination for the departure rows ("Diridon", not "San Jose
// Diridon") — headsign is the destination station's full name.
export function shortHeadsign(dep: { headsign?: string } | null): string {
  const headsign = dep?.headsign ?? '';
  const match = modelStations().find((s: { name: string; shortName: string }) => s.name === headsign);
  return match ? match.shortName : headsign;
}

function liveRowByRunId(runId: string, departureRows: readonly LiveDepartureRow[] | null | undefined): LiveDepartureRow | null {
  if (!String(runId || '').startsWith('live:')) return null;
  const key = String(runId).slice(5);
  return (departureRows ?? []).find((row) =>
    row._id === key ||
    row.departureId === key ||
    `${row.stationId}:${row.predictedDepartureMs}:${row.trainNumber ?? ''}` === key
  ) ?? null;
}

function stationByName(name: string | null | undefined) {
  const normalized = String(name || '').toLowerCase();
  return modelStations().find((s: { id: string; name: string; shortName: string }) =>
    normalized.includes(s.name.toLowerCase()) || normalized.includes(s.shortName.toLowerCase())
  ) ?? null;
}

function realTrainNumber(row: LiveDepartureRow): string | null {
  const value = String(row.trainNumber ?? '');
  return /^\d+$/.test(value) ? value : null;
}

// All liveDepartures rows that belong to the same physical journey as `live`.
// 511 StopMonitoring is stop-centric: one journey surfaces as one row per
// monitored station, joined by DatedVehicleJourneyRef (departureId), with the
// real train number as the fallback join key when the ref is absent.
function liveJourneyRows(live: LiveDepartureRow, departureRows: readonly LiveDepartureRow[] | null | undefined): LiveDepartureRow[] {
  const trainNumber = realTrainNumber(live);
  return (departureRows ?? []).filter((row) => {
    if (row.direction !== live.direction) return false;
    if (live.departureId && row.departureId === live.departureId) return true;
    return trainNumber !== null && realTrainNumber(row) === trainNumber;
  });
}

function liveSpeedFactor(patternId: string, service: string): number {
  const pattern = PATTERNS.find((p: { id: string }) => p.id === patternId);
  if (pattern) return pattern.speedFactor;
  if (service === 'Baby Bullet') return 0.66;
  if (service === 'Limited') return 0.82;
  return 1.0;
}

// Rebuild the full trip for a live 511 run (ENG-23729). The stop sequence comes
// from the service pattern (from the boarding station to the destination); each
// stop's time is the journey's own StopMonitoring row where the feed has one,
// and otherwise the pattern's corridor travel time anchored at the boarding
// stop's live times, marked `estimated`. This is what keeps a multi-station run
// from ever rendering as "0 min · 2 stops" with duplicated endpoint timestamps
// unless the feed itself says exactly that.
function buildLiveTrainRun(runId: string, live: LiveDepartureRow, departureRows: readonly LiveDepartureRow[] | null | undefined, nowMs: number) {
  const boarding = getStationById(live.stationId);
  if (!boarding) return null;
  const towardSouth = live.direction !== 'north';
  const destination = stationByName(live.headsign) ?? getStationById(towardSouth ? 'san-jose' : 'san-francisco');

  // The freshest live row per station for this journey (the feed can carry
  // more than one visit per stop; keep the earliest upcoming one).
  const rowsByStation = new Map<string, LiveDepartureRow>();
  for (const row of liveJourneyRows(live, departureRows)) {
    const existing = rowsByStation.get(row.stationId);
    if (!existing || Number(row.predictedDepartureMs) < Number(existing.predictedDepartureMs)) {
      rowsByStation.set(row.stationId, row);
    }
  }

  // Stop sequence: the service pattern's stop list from the boarding station to
  // the destination when the pattern serves the boarding stop; otherwise just
  // the journey's own observed stations, corridor-ordered.
  const pattern = PATTERNS.find((p: { id: string; stopIds: string[] }) => p.id === (live.patternId ?? ''));
  let stationIds: string[];
  if (pattern && pattern.stopIds.includes(boarding.id)) {
    const from = pattern.stopIds.indexOf(boarding.id);
    const destIndex = destination ? pattern.stopIds.indexOf(destination.id) : -1;
    stationIds = pattern.stopIds.slice(from, (destIndex > from ? destIndex : pattern.stopIds.length - 1) + 1);
  } else {
    const bounds = destination ?? boarding;
    stationIds = [...rowsByStation.keys(), boarding.id, ...(destination ? [destination.id] : [])]
      .map((id) => getStationById(id))
      .filter((station) => station !== null)
      .filter((station) => towardSouth
        ? station.orderIndex >= boarding.orderIndex && station.orderIndex <= Math.max(bounds.orderIndex, boarding.orderIndex)
        : station.orderIndex <= boarding.orderIndex && station.orderIndex >= Math.min(bounds.orderIndex, boarding.orderIndex))
      .sort((a, b) => (towardSouth ? a.orderIndex - b.orderIndex : b.orderIndex - a.orderIndex))
      .map((station) => station.id)
      .filter((id, index, ids) => ids.indexOf(id) === index);
  }
  if (stationIds.length === 0) stationIds = [boarding.id];

  const speedFactor = liveSpeedFactor(live.patternId ?? '', live.service || 'Local');
  const stops = stationIds.map((stationId, sequence) => {
    const station = getStationById(stationId);
    const row = rowsByStation.get(stationId);
    if (row) {
      return {
        station,
        sequence,
        scheduledTimeMs: Number(row.scheduledDepartureMs),
        predictedTimeMs: Number(row.predictedDepartureMs),
        estimated: false,
      };
    }
    const offsetMs = Math.round(Math.abs(station.minutesFromSf - boarding.minutesFromSf) * speedFactor) * 60_000;
    return {
      station,
      sequence,
      scheduledTimeMs: Number(live.scheduledDepartureMs) + offsetMs,
      predictedTimeMs: Number(live.predictedDepartureMs) + offsetMs,
      estimated: true,
    };
  });

  const durationMinutes = stops.length > 1
    ? Math.round((stops[stops.length - 1].scheduledTimeMs - stops[0].scheduledTimeMs) / 60_000)
    : 0;

  return {
    id: runId,
    patternId: live.patternId ?? '',
    direction: live.direction,
    service: live.service || 'Local',
    trainNumber: live.trainNumber || '',
    delaySeconds: live.delaySeconds ?? 0,
    origin: boarding,
    destination,
    headsign: live.headsign || destination?.name || '',
    stopCount: stops.length,
    durationMinutes,
    stops,
    position: computePosition(stops, nowMs),
  };
}

export function getTrainRun(runId: string, nowMs: number, delayRows: DelayRow[], departureRows: LiveDepartureRow[]) {
  const live = liveRowByRunId(runId, departureRows);
  if (live) return buildLiveTrainRun(runId, live, departureRows, nowMs);
  return modelTrainRun(runId, nowMs, delaysFrom(delayRows));
}

// The served stops from the boarding station onward, for the expanded hero.
export function upcomingStops(runId: string, stationId: string, nowMs: number, limit: number, delayRows: DelayRow[], departureRows: LiveDepartureRow[]) {
  const trip = getTrainRun(runId, nowMs, delayRows, departureRows);
  if (!trip) return [];
  const boardingIndex = trip.stops.findIndex((stop: { station: { id: string } }) => stop.station.id === stationId);
  const from = boardingIndex >= 0 ? boardingIndex : 0;
  return trip.stops.slice(from, from + (limit || 6)).map((stop: { station: { id: string; shortName: string }; predictedTimeMs: number; estimated?: boolean }) => ({
    id: stop.station.id,
    name: stop.station.shortName,
    time: stopClockLabel(stop),
    isBoarding: stop.station.id === stationId,
  }));
}

// Clock label for a stop row: real times (model schedule or live 511 rows)
// render plain; times interpolated from the pattern for stations the live feed
// did not cover are marked approximate.
export function stopClockLabel(stop: { predictedTimeMs: number; estimated?: boolean }): string {
  return `${stop.estimated ? '~' : ''}${modelFormatClockTime(stop.predictedTimeMs)}`;
}

// --- Formatting ---------------------------------------------------------------

export function formatClockTime(timestampMs: number): string {
  return modelFormatClockTime(timestampMs);
}

export function formatCountdownMinutes(targetMs: number, nowMs: number): number {
  return modelFormatCountdown(targetMs, nowMs);
}

export function serviceColor(service: string): string {
  return modelServiceColor(service);
}

export function serviceTint(service: string): string {
  return `${modelServiceColor(service)}22`; // ~13% alpha pill background
}

// --- Walk / bike (haversine over the seed coordinates) ------------------------
//
// E4 / ENG-23795: the app-wide ETA mode is 'auto' | 'walk' | 'bike'. 'auto'
// (the default) resolves per station: beyond an 18-minute walk the app
// defaults to biking directions; an explicit toggle in Settings pins the mode.

const AUTO_BIKE_OVER_WALK_MINUTES = 18;

export function effectiveEtaMode(station: RouteStation, mode: string, _tick?: number): RouteMode {
  if (mode === 'walk' || mode === 'bike') return mode;
  const walkMinutes = estimateWalkMinutes(getUserLocation(), station);
  return walkMinutes > AUTO_BIKE_OVER_WALK_MINUTES ? 'bike' : 'walk';
}

export function etaModeLabel(mode: string): string {
  if (mode === 'bike') return '🚴 Bike';
  if (mode === 'walk') return '🚶 Walk';
  return 'Auto';
}

// The accessible label on the header directions affordance. It doubles as the
// web glue's channel for the resolved travel mode (the glue builds the maps
// URL from it), so the wording must keep the literal words walking/biking.
export function directionsLabel(station: RouteStation, mode: string, _tick?: number): string {
  return effectiveEtaMode(station, mode) === 'bike' ? 'Get biking directions' : 'Get walking directions';
}

function normalizedRouteMode(mode: string): RouteMode {
  return mode === 'bike' ? 'bike' : 'walk';
}

function routeCacheKey(location: LatLng, station: RouteStation, mode: RouteMode): string {
  const stationKey = station.id ?? `${station.lat.toFixed(5)},${station.lng.toFixed(5)}`;
  return `${mode}:${location.lat.toFixed(4)},${location.lng.toFixed(4)}:${stationKey}`;
}

function fallbackRouteEstimate(station: RouteStation, mode: RouteMode, location: LatLng): RouteEstimateResult {
  const miles = estimateDistanceMiles(location, station);
  const minutes = mode === 'bike' ? estimateBikeMinutes(location, station) : estimateWalkMinutes(location, station);
  return { mode, minutes, distanceMiles: miles, source: 'haversine' };
}

function cachedRouteEstimate(station: RouteStation, modeInput: string, location: LatLng): RouteEstimateResult {
  const mode = normalizedRouteMode(modeInput);
  const key = routeCacheKey(location, station, mode);
  const now = Date.now();
  const cached = routeCache.get(key);
  const maxAge = cached?.estimate.cacheTtlMs ?? ROUTE_CACHE_TTL_MS;
  if (cached && now - cached.storedAt < maxAge) return cached.estimate;

  if (routeEstimateInvoker && !routeInFlight.has(key)) {
    routeInFlight.add(key);
    routeEstimateInvoker({
      fromLat: location.lat,
      fromLng: location.lng,
      toLat: station.lat,
      toLng: station.lng,
      mode,
    }).then((estimate) => {
      if (estimate && typeof estimate === 'object') {
        routeCache.set(key, { estimate, storedAt: Date.now() });
      }
    }).catch(() => {
      // The server action already has a fallback path. If the transport itself
      // fails, keep rendering the deterministic local estimate.
    }).finally(() => {
      routeInFlight.delete(key);
    });
  }

  return fallbackRouteEstimate(station, mode, location);
}

export function walkBikeSummary(station: RouteStation, mode: string, _tick?: number): string {
  const location = getUserLocation();
  const effective = effectiveEtaMode(station, mode);
  const estimate = cachedRouteEstimate(station, effective, location);
  const minutes = Math.max(1, Math.round(Number(estimate.minutes) || 1));
  const miles = Number(estimate.distanceMiles) || 0;
  const label = effective === 'bike' ? 'bike' : 'walk';
  // A routed ETA (openrouteservice) shows plain; the straight-line haversine
  // fallback is marked approximate so estimated numbers never pose as routed.
  const approx = estimate.source === 'openrouteservice' ? '' : '~';
  return `${approx}${minutes} min ${label} · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// The header directions line: mode glyph + summary + an explicit directions
// symbol, one tap/press affordance (ENG-23795).
export function walkBikeLine(station: RouteStation, mode: string, _tick?: number): string {
  const glyph = effectiveEtaMode(station, mode) === 'bike' ? '🚴' : '🚶';
  return `${glyph} ${walkBikeSummary(station, mode)} ⬈`;
}

// Compact ETA for the stations-list rows: the mode's minutes plus distance
// (the full summary is too wide there).
export function distanceLabel(station: RouteStation, mode: string, _tick?: number): string {
  const location = getUserLocation();
  const estimate = fallbackRouteEstimate(station, effectiveEtaMode(station, mode), location);
  const minutes = Math.max(1, Math.round(Number(estimate.minutes) || 1));
  const miles = Number(estimate.distanceMiles) || 0;
  return `${minutes} min · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// --- Freshness marker (feedState rows from the live query binding) ------------

export function feedFreshness(nowMs: number, feedRows: Array<{ fetchedAt?: number }>): string {
  const feed = feedRows?.[0] ?? null;
  // Board-first startup (ENG-23727): before the backend has attached, the
  // board shows deterministic schedule times — say so, instead of implying a
  // feed is on its way that may never arrive.
  if (!feed || !feed.fetchedAt) return backendState === 'connected' ? 'Waiting for feed…' : 'Scheduled times';
  const ageSeconds = Math.max(0, Math.floor((nowMs - feed.fetchedAt) / 1000));
  if (ageSeconds < 60) return 'Updated a few seconds ago';
  return `Updated ${Math.max(1, Math.floor(ageSeconds / 60))}m ago`;
}

// --- Data-source badge (live 511 feed vs the recorded demo feed) ---------------
//
// feedRefreshState.lastSource records where the last committed refresh came
// from (handlers.mjs): '511-siri-stop-monitoring' only when a real 511 fetch
// landed; 'seed' / 'recorded' / 'recorded-fallback' / 'reset' all mean the
// board is showing the canned demo feed. The badge makes that distinction
// visible on the board instead of leaving demo data to pose as live data.

// Why the board is NOT on live 511 data, when there is a recorded reason.
// refreshFeed commits an actionable lastError on every fallback (ENG-22751);
// an intentional demo run (seed/recorded, no error) stays quiet.
export function feedProblem(feedRows: Array<{ lastSource?: string; lastError?: string }>): string {
  const feed = feedRows?.[0] ?? null;
  if (!feed || (feed.lastSource ?? '') === LIVE_FEED_SOURCE) return '';
  const error = (feed.lastError ?? '').trim();
  if (!error) return '';
  return error.length > 180 ? `${error.slice(0, 177)}…` : error;
}

// Fallback freshness window when the committed row predates the field; matches
// seed.gen.mjs (two 180s warm-poll cycles + 30s grace, ENG-23642).
const DEFAULT_STALE_AFTER_MS = 390_000;

// LIVE only when the last committed refresh was a real 511 snapshot AND it is
// younger than the freshness window. A live source whose rows have aged out is
// STALE (marked non-live), never LIVE — an advancing feed marker can no longer
// dress old rows up as live data (ENG-23642). The rows themselves stay on
// screen (they are real observed departures, self-expiring per departure via
// DEPARTED_GRACE_MS) rather than being swapped for synthetic demo trains.
// `dot` is the sticky-footer status dot (ENG-23795): green only when live,
// gray otherwise — the LIVE text is gone, but the non-live labels stay
// rendered next to the dot so demo/schedule data never poses as live
// (the ENG-23642 honesty requirement).
export function feedSourceBadge(
  feedRows: Array<{ lastSource?: string; fetchedAt?: number; staleAfterMs?: number }>,
  nowMs?: number,
): {
  live: boolean;
  label: string;
  color: string;
  tint: string;
  border: string;
  dot: string;
} {
  const feed = feedRows?.[0] ?? null;
  // No feed row yet (board-first startup, before the live bindings deliver):
  // the board is on the deterministic schedule — its own honest category,
  // neither a committed demo feed nor live 511 (ENG-23727).
  if (!feed) {
    return { live: false, label: 'SCHEDULE', color: '#1D4ED8', tint: '#1D4ED812', border: '#1D4ED836', dot: '#9CA3AF' };
  }
  const liveSource = (feed?.lastSource ?? '') === LIVE_FEED_SOURCE;
  // Light-theme badge colors (ENG-23719): the badge sits on the white board.
  if (!liveSource) {
    return { live: false, label: 'DEMO DATA', color: '#92400E', tint: '#B4530914', border: '#B4530936', dot: '#9CA3AF' };
  }
  const fetchedAt = Number(feed?.fetchedAt) || 0;
  const staleAfterMs = Number(feed?.staleAfterMs) > 0 ? Number(feed?.staleAfterMs) : DEFAULT_STALE_AFTER_MS;
  const fresh = typeof nowMs !== 'number' || fetchedAt <= 0 || nowMs - fetchedAt <= staleAfterMs;
  return fresh
    ? { live: true, label: 'LIVE', color: '#047857', tint: '#04785712', border: '#04785736', dot: '#059669' }
    : { live: false, label: 'STALE', color: '#B91C1C', tint: '#B91C1C12', border: '#B91C1C36', dot: '#9CA3AF' };
}

// --- Position indicator (for the train detail continuum) ----------------------

export function positionFraction(trip: { position?: { corridorFraction: number } | null }): number {
  return trip && trip.position ? trip.position.corridorFraction : 0;
}

export function positionLabel(trip: {
  position?: { state: string; prevStationId: string | null; nextStationId: string | null } | null;
}): string {
  const position = trip?.position;
  if (!position) return '';
  const prev = position.prevStationId ? getStationById(position.prevStationId)?.name : null;
  const next = position.nextStationId ? getStationById(position.nextStationId)?.name : null;
  if (position.state === 'before') return `Departs ${next ?? ''}`;
  if (position.state === 'after') return `Arrived ${prev ?? ''}`;
  return `Between ${prev ?? ''} and ${next ?? ''}`;
}

// --- Percent string for the position bar width --------------------------------

export function fractionPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}

export { getNearestStation };
