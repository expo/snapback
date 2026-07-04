// Presentation helpers for the React surface.
//
// The transit math is the shared model (../../snapback/shared/model.mjs),
// imported unchanged — same file the Contract arm and the headless tests use.
// The wrappers here are the React twin of the Contract arm's data.ts, minus its
// device-location module state: everything takes explicit arguments (location,
// delay rows, feed rows) supplied by the caller from `useLiveState()`.

import {
  assumedDirection,
  estimateBikeMinutes,
  estimateDistanceMiles,
  estimateWalkMinutes,
  formatClockTime,
  getStationById,
  getStations,
  getTrainRun,
  getUpcomingDepartures,
  serviceColor,
} from '../../../snapback/shared/model.mjs';
import { cachedRouteEstimate, requestRouteEstimate } from './store.ts';
import type { DelayRow, FeedRow, LatLng, LocationSource } from './store.ts';

export const DEFAULT_LOCATION: LatLng = { lat: 37.3894, lng: -122.0819 }; // Mountain View fallback

export interface Station {
  id: string;
  name: string;
  shortName: string;
  orderIndex: number;
  zone: number;
  lat: number;
  lng: number;
}

// A friendly, on-card signal of whether the nearest station came from the device
// or a fallback — so a denied/dismissed permission prompt is legible, not silent.
// The denied line says what to do about it: once the user re-allows access
// (the hint press re-prompts; a site-settings flip fires the permission change
// event main.tsx listens for), the board adopts the real location, no reload.
export function locationHint(source: LocationSource): string {
  switch (source) {
    case 'device': return '📍 Using your location';
    case 'denied': return 'Location blocked — allow location for this site, then tap here';
    case 'unavailable': return 'Location unavailable — showing a default stop';
    default: return 'Allow location for your nearest stop';
  }
}

// --- Direction ------------------------------------------------------------------

export function activeDirection(override: string | null, station: { orderIndex: number }): string {
  if (override === 'north' || override === 'south') return override;
  return assumedDirection(station);
}

export function oppositeDirection(direction: string): string {
  return direction === 'north' ? 'south' : 'north';
}

export function serviceTint(service: string): string {
  return `${serviceColor(service)}22`; // ~13% alpha pill background
}

// --- Boards + trips (live delays arrive as liveTrainStatus rows) -----------------

// liveTrainStatus rows -> the patternId -> delaySeconds map the model expects.
export function delaysFrom(delayRows: readonly DelayRow[] | null | undefined): Record<string, number> {
  const delays: Record<string, number> = {};
  for (const row of delayRows ?? []) delays[row.patternId] = row.delaySeconds;
  return delays;
}

export interface Departure {
  id: string;
  service: string;
  trainNumber: string;
  headsign: string;
  predictedDepartureMs: number;
  delaySeconds?: number;
}

export interface HeroBoard {
  hero: Departure | null;
  rest: Departure[];
  hasPrev: boolean;
  hasNext: boolean;
  offset: number;
}

// The service-filter chips on the home board (E3): 'All' passes everything;
// 'Bullet' is the compact chip label for the 'Baby Bullet' service class.
export interface ServiceFilterOption {
  id: string;
  label: string;
}

export function serviceFilterOptions(): ServiceFilterOption[] {
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
export function boardTrains(
  stationId: string,
  direction: string,
  nowMs: number,
  heroOffset: number,
  delayRows: readonly DelayRow[],
  serviceFilter: string,
): HeroBoard {
  const wanted = Math.max(0, heroOffset ?? 0);
  const unfiltered = serviceFilter && serviceFilter !== 'All';
  const fetchLimit = unfiltered ? 40 : wanted + 5;
  const rows: Departure[] = filterByService(
    getUpcomingDepartures(stationId, direction, nowMs, delaysFrom(delayRows), fetchLimit) as Departure[],
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
  const match = getStations().find((s: { name: string; shortName: string }) => s.name === headsign);
  return match ? match.shortName : headsign;
}

// --- The served stops from the boarding station onward, for the expanded hero ----

export interface UpcomingStop {
  id: string;
  name: string;
  time: string;
  isBoarding: boolean;
}

interface TripStop {
  station: { id: string; shortName: string };
  predictedTimeMs: number;
}

export function upcomingStops(
  runId: string,
  stationId: string,
  nowMs: number,
  limit: number,
  delayRows: readonly DelayRow[],
): UpcomingStop[] {
  // The model types stop.station as nullable (a lookup that cannot miss for
  // seeded runs); assert the runtime reality once at this boundary.
  const trip = getTrainRun(runId, nowMs, delaysFrom(delayRows)) as { stops: TripStop[] } | null;
  if (!trip) return [];
  const boardingIndex = trip.stops.findIndex((stop) => stop.station.id === stationId);
  const from = boardingIndex >= 0 ? boardingIndex : 0;
  return trip.stops.slice(from, from + (limit || 6)).map((stop) => ({
    id: stop.station.id,
    name: stop.station.shortName,
    time: formatClockTime(stop.predictedTimeMs),
    isBoarding: stop.station.id === stationId,
  }));
}

// --- Walk / bike (haversine over the seed coordinates) ---------------------------
//
// E4: the app-wide ETA mode ('walk' | 'bike', toggled from the station card)
// selects which estimate the summary and the stations-list rows show.

export type EtaMode = 'walk' | 'bike';

export function etaModeLabel(mode: EtaMode): string {
  return mode === 'bike' ? '🚴 Bike' : '🚶 Walk';
}

export function walkBikeSummary(station: { id?: string; lat: number; lng: number }, mode: EtaMode, location: LatLng): string {
  requestRouteEstimate(location, station, mode);
  const routed = cachedRouteEstimate(location, station, mode);
  const minutes = routed?.minutes
    ? Math.max(1, Math.round(routed.minutes))
    : mode === 'bike'
      ? estimateBikeMinutes(location, station)
      : estimateWalkMinutes(location, station);
  const miles = routed?.distanceMiles ?? estimateDistanceMiles(location, station);
  return `${minutes} min ${mode === 'bike' ? 'bike' : 'walk'} · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// Compact ETA for the stations-list rows: the mode's minutes plus distance
// (the full summary is too wide there).
export function distanceLabel(station: { lat: number; lng: number }, mode: EtaMode, location: LatLng): string {
  const minutes = mode === 'bike' ? estimateBikeMinutes(location, station) : estimateWalkMinutes(location, station);
  const miles = estimateDistanceMiles(location, station);
  return `${minutes} min · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// --- Freshness marker (feedState rows from the live subscription) ----------------

export function feedFreshness(nowMs: number, feedRows: readonly FeedRow[]): string {
  const feed = feedRows?.[0] ?? null;
  if (!feed || !feed.fetchedAt) return 'Waiting for feed…';
  const ageSeconds = Math.max(0, Math.round((nowMs - feed.fetchedAt) / 1000));
  if (ageSeconds < 5) return 'Updated just now';
  if (ageSeconds < 90) return `Updated ${ageSeconds}s ago`;
  return `Updated ${Math.round(ageSeconds / 60)} min ago`;
}

// Why the board is NOT on live 511 data, when there is a recorded reason.
// refreshFeed commits an actionable lastError on every fallback (ENG-22751);
// an intentional demo run (seed/recorded, no error) stays quiet.
export function feedProblem(feedRows: readonly FeedRow[]): string {
  const feed = feedRows?.[0] ?? null;
  if (!feed || (feed.lastSource ?? '') === '511-siri-stop-monitoring') return '';
  const error = (feed.lastError ?? '').trim();
  if (!error) return '';
  return error.length > 180 ? `${error.slice(0, 177)}…` : error;
}

// --- Position indicator (for the train detail continuum) -------------------------

export interface TripPosition {
  state: string;
  prevStationId: string | null;
  nextStationId: string | null;
  corridorFraction: number;
}

export function positionLabel(trip: { position?: TripPosition | null }): string {
  const position = trip?.position;
  if (!position) return '';
  const prev = position.prevStationId ? getStationById(position.prevStationId)?.name : null;
  const next = position.nextStationId ? getStationById(position.nextStationId)?.name : null;
  if (position.state === 'before') return `Departs ${next ?? ''}`;
  if (position.state === 'after') return `Arrived ${prev ?? ''}`;
  return `Between ${prev ?? ''} and ${next ?? ''}`;
}

export function positionFraction(trip: { position?: TripPosition | null }): number {
  return trip?.position ? trip.position.corridorFraction : 0;
}

export function fractionPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
}
