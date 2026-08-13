export const CHANNEL_A_RATE_WINDOW_MS = 60_000;
export const CHANNEL_A_RATE_WINDOW_MAX_KEYS = 4096;

// Best-effort per-isolate Channel A admission. Expired keys disappear during
// each sweep, and a hard cap evicts the least-recently-observed remaining key.
export function admitChannelARate(
  windows,
  key,
  nowMs,
  { limit = 60, maxKeys = CHANNEL_A_RATE_WINDOW_MAX_KEYS } = {},
) {
  for (const [candidate, entry] of windows) {
    while (entry.timestamps.length > 0 && nowMs - entry.timestamps[0] >= CHANNEL_A_RATE_WINDOW_MS) {
      entry.timestamps.shift();
    }
    if (entry.timestamps.length === 0) windows.delete(candidate);
  }

  let entry = windows.get(key);
  if (!entry) {
    while (windows.size >= maxKeys) {
      let oldestKey = null;
      let oldestSeenAt = Infinity;
      for (const [candidate, value] of windows) {
        if (value.lastSeenAt < oldestSeenAt) {
          oldestKey = candidate;
          oldestSeenAt = value.lastSeenAt;
        }
      }
      if (oldestKey === null) break;
      windows.delete(oldestKey);
    }
    entry = { timestamps: [], lastSeenAt: nowMs };
    windows.set(key, entry);
  }
  entry.lastSeenAt = nowMs;
  if (entry.timestamps.length >= limit) return false;
  entry.timestamps.push(nowMs);
  return true;
}
