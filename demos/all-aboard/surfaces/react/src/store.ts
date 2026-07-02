// Live-data store for the React surface.
//
// Same seam as the Contract arm's store.mjs (main.tsx writes Snapback live
// delays / freshness / geolocation here), but shaped the way a React app
// naturally consumes external state: an immutable snapshot plus a subscribe
// function, read through `useSyncExternalStore`. Components re-render the
// moment a poll lands instead of waiting for the next clock tick, and the
// helpers can take the state as an explicit argument rather than reading a
// hidden mutable store behind a `_tick` cache-buster parameter.

import { useEffect, useState, useSyncExternalStore } from 'react';

export interface LatLng {
  lat: number;
  lng: number;
}

export type LocationSource = 'device' | 'default' | 'denied' | 'unavailable';

export interface FeedRow {
  fetchedAt: number;
  tickIndex: number;
  lastSource?: string;
}

export interface LiveState {
  delays: Record<string, number>; // patternId -> delaySeconds (from liveTrainStatus)
  feed: FeedRow | null; // feedRefreshState row
  location: LatLng | null; // device location, or null => default
  locationSource: LocationSource;
}

let state: LiveState = { delays: {}, feed: null, location: null, locationSource: 'default' };
const listeners = new Set<() => void>();

function emit(next: LiveState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function setDelays(rows: Array<{ patternId: string; delaySeconds: number }> | null | undefined): void {
  const delays: Record<string, number> = {};
  for (const row of rows ?? []) delays[row.patternId] = row.delaySeconds;
  emit({ ...state, delays });
}

export function setFeed(row: FeedRow | null | undefined): void {
  emit({ ...state, feed: row ?? null });
}

export function setLocation(location: LatLng | null, source?: LocationSource): void {
  emit({ ...state, location, locationSource: source ?? (location ? 'device' : 'default') });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live Snapback-fed state; re-renders the caller whenever a poll lands. */
export function useLiveState(): LiveState {
  return useSyncExternalStore(subscribe, () => state);
}

/** A ticking clock for countdowns and freshness ages. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
