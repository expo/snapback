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
const DEFAULT_LOCATION = { lat: 37.3894, lng: -122.0819 }; // Mountain View fallback

// --- Device location (device-capability glue, set by main.ts) -----------------

type LatLng = { lat: number; lng: number };
let deviceLocation: LatLng | null = null;
let deviceLocationSource = 'default'; // 'device' | 'default' | 'denied' | 'unavailable'

export function setDeviceLocation(location: LatLng | null, source?: string): void {
  deviceLocation = location ?? null;
  deviceLocationSource = source ?? (location ? 'device' : 'default');
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
export function locationHint(_tick?: number): string {
  switch (deviceLocationSource) {
    case 'device': return '📍 Using your location';
    case 'denied': return 'Location blocked — showing a default stop';
    case 'unavailable': return 'Location unavailable — showing a default stop';
    default: return 'Allow location for your nearest stop';
  }
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

// --- Direction ----------------------------------------------------------------

export function assumedDirection(station: { orderIndex: number }): string {
  return modelAssumedDirection(station);
}

export function activeDirection(override: string | null, station: { orderIndex: number }): string {
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

// liveTrainStatus rows -> the patternId -> delaySeconds map the model expects.
function delaysFrom(delayRows: readonly DelayRow[] | null | undefined): Record<string, number> {
  const delays: Record<string, number> = {};
  for (const row of delayRows ?? []) delays[row.patternId] = row.delaySeconds;
  return delays;
}

export function getDirectionBoard(stationId: string, direction: string, nowMs: number, limit: number, delayRows: DelayRow[]) {
  return modelDirectionBoard(stationId, direction, nowMs, delaysFrom(delayRows), limit);
}

// The service-filter chips on the home board (E3): 'All' passes everything;
// 'Bullet' is the compact chip label for the 'Baby Bullet' service class.
export function serviceFilterOptions() {
  return [
    { id: 'All', label: 'All' },
    { id: 'Local', label: 'Local' },
    { id: 'Limited', label: 'Limited' },
    { id: 'Baby Bullet', label: 'Bullet' },
  ];
}

function filterByService<T extends { service?: string }>(rows: T[], serviceFilter: string | null | undefined): T[] {
  if (!serviceFilter || serviceFilter === 'All') return rows;
  return rows.filter((row) => row.service === serviceFilter);
}

// The hero-selection board: `heroOffset` walks the upcoming trains (swipe
// up/down or the ▲▼ arrows), the three after it stay listed. The offset is
// clamped to the rows that exist, so an offset stranded by time passing (the
// selected train departs) degrades to the last remaining train. The service
// filter (E3) applies to the whole board — hero included — so it fetches a
// wide window before filtering rather than filtering a pre-limited slice.
export function boardTrains(stationId: string, direction: string, nowMs: number, heroOffset: number, delayRows: DelayRow[], serviceFilter: string) {
  const wanted = Math.max(0, heroOffset ?? 0);
  const unfiltered = serviceFilter && serviceFilter !== 'All';
  const fetchLimit = unfiltered ? 40 : wanted + 5;
  const rows = filterByService(
    modelUpcomingDepartures(stationId, direction, nowMs, delaysFrom(delayRows), fetchLimit),
    serviceFilter,
  ).slice(0, wanted + 5);
  const offset = rows.length === 0 ? 0 : Math.min(wanted, rows.length - 1);
  return {
    hero: rows[offset] ?? null,
    rest: rows.slice(offset + 1, offset + 4),
    hasPrev: offset > 0,
    hasNext: rows.length > offset + 1,
    offset,
  };
}

// On-time / late marker for a departure (or a trip; both carry delaySeconds).
export function delayLabel(dep: { delaySeconds?: number } | null): string {
  if (!dep) return '';
  const s = dep.delaySeconds ?? 0;
  return s >= 45 ? `${Math.max(1, Math.round(s / 60))} min late` : 'on time';
}

export function delayColor(dep: { delaySeconds?: number } | null): string {
  return (dep?.delaySeconds ?? 0) >= 45 ? '#fbbf24' : '#34d399';
}

// Compact destination for the departure rows ("Diridon", not "San Jose
// Diridon") — headsign is the destination station's full name.
export function shortHeadsign(dep: { headsign?: string } | null): string {
  const headsign = dep?.headsign ?? '';
  const match = modelStations().find((s: { name: string; shortName: string }) => s.name === headsign);
  return match ? match.shortName : headsign;
}

export function getTrainRun(runId: string, nowMs: number, delayRows: DelayRow[]) {
  return modelTrainRun(runId, nowMs, delaysFrom(delayRows));
}

// The served stops from the boarding station onward, for the expanded hero.
export function upcomingStops(runId: string, stationId: string, nowMs: number, limit: number, delayRows: DelayRow[]) {
  const trip = modelTrainRun(runId, nowMs, delaysFrom(delayRows));
  if (!trip) return [];
  const boardingIndex = trip.stops.findIndex((stop: { station: { id: string } }) => stop.station.id === stationId);
  const from = boardingIndex >= 0 ? boardingIndex : 0;
  return trip.stops.slice(from, from + (limit || 6)).map((stop: { station: { id: string; shortName: string }; predictedTimeMs: number }) => ({
    id: stop.station.id,
    name: stop.station.shortName,
    time: modelFormatClockTime(stop.predictedTimeMs),
    isBoarding: stop.station.id === stationId,
  }));
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

export function walkBikeSummary(station: { lat: number; lng: number }, _tick?: number): string {
  const location = getUserLocation();
  const walk = estimateWalkMinutes(location, station);
  const bike = estimateBikeMinutes(location, station);
  const miles = estimateDistanceMiles(location, station);
  return `${walk} min walk · ${bike} min bike · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// Compact distance for the stations-list rows, where the full walk/bike
// summary is too wide (and a 300-minute walk reads as noise).
export function distanceLabel(station: { lat: number; lng: number }, _tick?: number): string {
  const miles = estimateDistanceMiles(getUserLocation(), station);
  return `${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// --- Freshness marker (feedState rows from the live query binding) ------------

export function feedFreshness(nowMs: number, feedRows: Array<{ fetchedAt?: number }>): string {
  const feed = feedRows?.[0] ?? null;
  if (!feed || !feed.fetchedAt) return 'Waiting for feed…';
  const ageSeconds = Math.max(0, Math.round((nowMs - feed.fetchedAt) / 1000));
  if (ageSeconds < 5) return 'Updated just now';
  if (ageSeconds < 90) return `Updated ${ageSeconds}s ago`;
  return `Updated ${Math.round(ageSeconds / 60)} min ago`;
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
