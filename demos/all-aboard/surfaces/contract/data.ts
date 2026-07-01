// Contract-facing data helpers for the All Aboard surface.
//
// These are the pure helpers the app.contract `use`s. The transit math lives in
// the shared model (imported unchanged); the wrappers here read the live delays
// and device location from store.mjs, which main.ts keeps in sync with Snapback.
//
// Reactivity note: the Contract compiler treats these as pure-by-args, so every
// helper that reads the mutable store also takes the ticking `nowMs` (a cache
// buster). Because the `every(1000, tick)` task advances nowMs each second, the
// derives re-run each second and pick up the latest server-pushed delay or a
// freshly resolved location — the same reactive trick the Facet caltrain twin uses
// with its clock, extended to Snapback-authored data.

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
  searchStations as modelSearch,
  serviceColor as modelServiceColor,
  stationPhoto as modelStationPhoto,
} from '../../snapback/shared/model.mjs';
import { getStoreState } from './store.mjs';

const DEFAULT_LOCATION = { lat: 37.3894, lng: -122.0819 }; // Mountain View fallback

// --- Location + station selection --------------------------------------------

export function getUserLocation(_tick?: number) {
  const { location } = getStoreState();
  return location ?? DEFAULT_LOCATION;
}

export function locationSource(_tick?: number): string {
  return getStoreState().locationSource;
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

// --- Boards + trips (read live delays from the store) -------------------------

export function getDirectionBoard(stationId: string, direction: string, nowMs: number, limit: number) {
  return modelDirectionBoard(stationId, direction, nowMs, getStoreState().delays, limit);
}

export function getTrainRun(runId: string, nowMs: number) {
  return modelTrainRun(runId, nowMs, getStoreState().delays);
}

// The served stops from the boarding station onward, for the expanded hero.
export function upcomingStops(runId: string, stationId: string, nowMs: number, limit: number) {
  const trip = modelTrainRun(runId, nowMs, getStoreState().delays);
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

// --- Freshness marker (reads feedRefreshState from the store) -----------------

export function feedFreshness(nowMs: number): string {
  const { feed } = getStoreState();
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
