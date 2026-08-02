// Fixed console polling for LLP 0154's Health and Logs pages. The callback
// invalidates the exact typed-operation resources; it does not add a live
// telemetry transport or a second query dialect.

export function watchTelemetryPoll(refresh: () => void, intervalMs = 5_000): () => void {
  if (typeof setInterval !== 'function') return () => {};
  const timer = setInterval(refresh, intervalMs);
  return () => clearInterval(timer);
}
