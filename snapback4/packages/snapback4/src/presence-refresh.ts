// A live watch whose answer read `connected[p]` re-runs after the interval its
// server named: presence changes without a commit, so no change feed names it
// (LLP 3000.017 §3).

/** The shortest refresh a client honors, whatever the server asks. */
export const PRESENCE_REFRESH_FLOOR_MS = 250;

/** Arms a watch's presence refresh when its answer asked for one, and clears
 * it otherwise. Returns the timer to keep. */
export function presenceRefresh(previous: ReturnType<typeof setTimeout> | null, after: number | undefined, rerun: () => void): ReturnType<typeof setTimeout> | null {
  if (previous) clearTimeout(previous);
  if (after === undefined) return null;
  const timer = setTimeout(rerun, Math.max(after, PRESENCE_REFRESH_FLOOR_MS));
  (timer as { unref?: () => void }).unref?.();
  return timer;
}
