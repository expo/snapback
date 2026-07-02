// Presentation helpers for the React surface.
//
// The transit math is the shared model (../../snapback/shared/model.mjs),
// imported unchanged — same file the Contract arm and the headless tests use.
// The wrappers here are the React twin of the Contract arm's data.ts, minus its
// store-closure/`_tick` indirection: everything takes explicit arguments
// (location, delays, feed) supplied by the caller from `useLiveState()`.

import {
  assumedDirection,
  estimateBikeMinutes,
  estimateDistanceMiles,
  estimateWalkMinutes,
  formatClockTime,
  formatCountdownMinutes,
  getStationById,
  getTrainRun,
  serviceColor,
} from '../../../snapback/shared/model.mjs';
import type { FeedRow, LatLng, LocationSource } from './store.ts';

export const DEFAULT_LOCATION: LatLng = { lat: 37.3894, lng: -122.0819 }; // Mountain View fallback

// A friendly, on-card signal of whether the nearest station came from the device
// or a fallback — so a denied/dismissed permission prompt is legible, not silent.
export function locationHint(source: LocationSource): string {
  switch (source) {
    case 'device': return '📍 Using your location';
    case 'denied': return 'Location blocked — showing a default stop';
    case 'unavailable': return 'Location unavailable — showing a default stop';
    default: return 'Allow location for your nearest stop';
  }
}

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

// --- Urgent departures (leaving within 5 minutes) ------------------------------

export const URGENT_RED = '#dc2626';
export const URGENT_TINT = '#dc262622';
const URGENT_THRESHOLD_MINUTES = 5;

export function isUrgent(predictedDepartureMs: number, nowMs: number): boolean {
  return formatCountdownMinutes(predictedDepartureMs, nowMs) <= URGENT_THRESHOLD_MINUTES;
}

// --- Walk / bike (haversine over the seed coordinates) ------------------------

export function walkBikeSummary(station: { lat: number; lng: number }, location: LatLng): string {
  const walk = estimateWalkMinutes(location, station);
  const bike = estimateBikeMinutes(location, station);
  const miles = estimateDistanceMiles(location, station);
  return `${walk} min walk · ${bike} min bike · ${miles.toFixed(miles < 10 ? 1 : 0)} mi`;
}

// --- Freshness marker ----------------------------------------------------------

export function feedFreshness(feed: FeedRow | null, nowMs: number): string {
  if (!feed || !feed.fetchedAt) return 'Waiting for feed…';
  const ageSeconds = Math.max(0, Math.round((nowMs - feed.fetchedAt) / 1000));
  if (ageSeconds < 5) return 'Updated just now';
  if (ageSeconds < 90) return `Updated ${ageSeconds}s ago`;
  return `Updated ${Math.round(ageSeconds / 60)} min ago`;
}

// --- The served stops from the boarding station onward, for the expanded hero --

export interface UpcomingStop {
  id: string;
  name: string;
  time: string;
  isBoarding: boolean;
}

export function upcomingStops(
  runId: string,
  stationId: string,
  nowMs: number,
  delays: Record<string, number>,
  limit = 6,
): UpcomingStop[] {
  const trip = getTrainRun(runId, nowMs, delays);
  if (!trip) return [];
  const boardingIndex = trip.stops.findIndex((stop: TripStop) => stop.station.id === stationId);
  const from = boardingIndex >= 0 ? boardingIndex : 0;
  return trip.stops.slice(from, from + limit).map((stop: TripStop) => ({
    id: stop.station.id,
    name: stop.station.shortName,
    time: formatClockTime(stop.predictedTimeMs),
    isBoarding: stop.station.id === stationId,
  }));
}

// --- Position indicator (for the train detail continuum) -----------------------

interface TripStop {
  station: { id: string; shortName: string };
  predictedTimeMs: number;
}

interface TripPosition {
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
