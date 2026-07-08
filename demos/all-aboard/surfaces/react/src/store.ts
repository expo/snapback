// Live-data store for the React surface.
//
// The React twin of the Contract arm's `query` bindings: main.tsx opens two
// kit `liveQuery` handles (transport 'stream' — server push over the shared
// live socket, LLP 0034 D1) and writes their rows + per-query connection
// values here; components read the snapshot through `useSyncExternalStore`
// and re-render the moment a push lands. The connection axis carries the same
// values the kit reports ('connecting' | 'live' | 'polling' | 'stale' |
// 'disconnected'), so the board's reconnecting treatment can mirror the
// Contract `stale rows` arm exactly (stale wins while degraded).

import { useEffect, useState, useSyncExternalStore } from 'react';

export interface LatLng {
  lat: number;
  lng: number;
}

export type LocationSource = 'device' | 'default' | 'denied' | 'unavailable';

export interface DelayRow {
  patternId: string;
  delaySeconds: number;
}

export interface FeedRow {
  fetchedAt: number;
  tickIndex: number;
  lastSource?: string;
  lastError?: string;
  staleAfterMs?: number;
}

export type ConnectionValue = 'connecting' | 'live' | 'polling' | 'stale' | 'disconnected' | null;
export type EtaMode = 'walk' | 'bike';

export interface RouteStation {
  id?: string;
  lat: number;
  lng: number;
}

export interface RouteEstimateArgs {
  fromLat: number;
  fromLng: number;
  toLat: number;
  toLng: number;
  mode: EtaMode;
}

export interface RouteEstimateResult {
  mode?: string;
  minutes?: number;
  distanceMiles?: number;
  source?: string;
  cacheTtlMs?: number;
  error?: string;
}

export interface LiveState {
  delayRows: DelayRow[]; // liveTrainStatus rows (live-pushed)
  feedRows: FeedRow[]; // feedRefreshState rows (live-pushed)
  delaysReady: boolean; // first liveTrainStatus snapshot has landed
  connections: { liveTrainStatus: ConnectionValue; feedState: ConnectionValue };
  location: LatLng | null; // device location, or null => default
  locationSource: LocationSource;
  routeEstimates: Record<string, { estimate: RouteEstimateResult; storedAt: number }>;
}

let state: LiveState = {
  delayRows: [],
  feedRows: [],
  delaysReady: false,
  connections: { liveTrainStatus: null, feedState: null },
  location: null,
  locationSource: 'default',
  routeEstimates: {},
};
const listeners = new Set<() => void>();
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
let routeEstimateInvoker: ((args: RouteEstimateArgs) => Promise<RouteEstimateResult>) | null = null;
const routeInFlight = new Set<string>();

function emit(next: LiveState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function setDelayRows(rows: DelayRow[] | null | undefined): void {
  emit({ ...state, delayRows: rows ?? [], delaysReady: true });
}

export function setFeedRows(rows: FeedRow[] | null | undefined): void {
  emit({ ...state, feedRows: rows ?? [] });
}

export function setConnection(name: 'liveTrainStatus' | 'feedState', value: ConnectionValue): void {
  emit({ ...state, connections: { ...state.connections, [name]: value } });
}

export function setLocation(location: LatLng | null, source?: LocationSource): void {
  emit({ ...state, location, locationSource: source ?? (location ? 'device' : 'default') });
}

export function setRouteEstimateInvoker(invoker: ((args: RouteEstimateArgs) => Promise<RouteEstimateResult>) | null): void {
  routeEstimateInvoker = invoker;
  routeInFlight.clear();
  emit({ ...state, routeEstimates: {} });
}

export function routeEstimateKey(location: LatLng, station: RouteStation, mode: EtaMode): string {
  const stationKey = station.id ?? `${station.lat.toFixed(5)},${station.lng.toFixed(5)}`;
  return `${mode}:${location.lat.toFixed(4)},${location.lng.toFixed(4)}:${stationKey}`;
}

export function cachedRouteEstimate(location: LatLng, station: RouteStation, mode: EtaMode): RouteEstimateResult | null {
  const key = routeEstimateKey(location, station, mode);
  const cached = state.routeEstimates[key];
  if (!cached) return null;
  const maxAge = cached.estimate.cacheTtlMs ?? ROUTE_CACHE_TTL_MS;
  return Date.now() - cached.storedAt < maxAge ? cached.estimate : null;
}

export function requestRouteEstimate(location: LatLng, station: RouteStation, mode: EtaMode): void {
  if (!routeEstimateInvoker) return;
  const key = routeEstimateKey(location, station, mode);
  const cached = cachedRouteEstimate(location, station, mode);
  if (cached || routeInFlight.has(key)) return;
  routeInFlight.add(key);
  routeEstimateInvoker({
    fromLat: location.lat,
    fromLng: location.lng,
    toLat: station.lat,
    toLng: station.lng,
    mode,
  }).then((estimate) => {
    if (!estimate || typeof estimate !== 'object') return;
    emit({
      ...state,
      routeEstimates: {
        ...state.routeEstimates,
        [key]: { estimate, storedAt: Date.now() },
      },
    });
  }).catch(() => {
    // Transport failures leave the local deterministic ETA in place.
  }).finally(() => {
    routeInFlight.delete(key);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live Snapback-fed state; re-renders the caller whenever a push lands. */
export function useLiveState(): LiveState {
  return useSyncExternalStore(subscribe, () => state);
}

/** A ticking clock for countdowns and freshness ages (UI clock, not transport). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
