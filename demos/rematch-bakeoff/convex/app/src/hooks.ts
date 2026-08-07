import { useEffect, useRef, useState } from "react";
import { useConvex, useQuery } from "convex/react";
import { cache } from "./storage";

// useQuery + persistent cache: returns live data when the backend answers,
// otherwise the last cached result (marked fromCache) so history is readable
// after a cold start with the backend down.
export function useCachedQuery<Query extends Parameters<typeof useQuery>[0]>(
  query: Query,
  args: any,
  cacheKey: string
): { data: any; fromCache: boolean } {
  const live = useQuery(query as any, args);
  const [cached, setCached] = useState<any>(undefined);
  useEffect(() => {
    let alive = true;
    cache.get(cacheKey).then((v) => {
      if (alive && v !== null) setCached(v);
    });
    return () => {
      alive = false;
    };
  }, [cacheKey]);
  useEffect(() => {
    if (live !== undefined) void cache.set(cacheKey, live);
  }, [live, cacheKey]);
  if (live !== undefined) return { data: live, fromCache: false };
  if (cached !== undefined) return { data: cached, fromCache: true };
  return { data: undefined, fromCache: false };
}

// Polls the Convex client's websocket state so the UI can show an
// offline banner.
export function useConnectionStatus(): boolean {
  const convex = useConvex();
  const [connected, setConnected] = useState(true);
  useEffect(() => {
    const id = setInterval(() => {
      try {
        setConnected(convex.connectionState().isWebSocketConnected);
      } catch {
        setConnected(false);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [convex]);
  return connected;
}

// Ticks every second — used to expire stale typing indicators client-side.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// Throttled typing reporter: fires setTyping(true) at most every 2s while the
// user edits, and setTyping(false) after 3s idle.
export function useTypingReporter(
  report: (isTyping: boolean) => void
): () => void {
  const lastSent = useRef(0);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    []
  );
  return () => {
    const now = Date.now();
    if (now - lastSent.current > 2000) {
      lastSent.current = now;
      report(true);
    }
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => report(false), 3000);
  };
}
