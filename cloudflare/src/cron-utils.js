// Small pure scheduler helpers kept outside the Worker module so boundary
// cases can be pinned without constructing a Durable Object.

export function nextNominalAfter(fromNominalMs, intervalMs, nowMs) {
  if (!Number.isFinite(fromNominalMs) || !Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(nowMs)) {
    throw new Error('nextNominalAfter requires finite times and a positive interval');
  }
  const elapsed = Math.floor((nowMs - fromNominalMs) / intervalMs);
  const steps = Math.max(1, elapsed + 1);
  return fromNominalMs + steps * intervalMs;
}
