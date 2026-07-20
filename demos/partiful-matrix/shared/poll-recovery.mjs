/**
 * Decide whether a polling provider must publish a successful query snapshot.
 * The first success after an error is authoritative even when its rows are
 * byte-for-byte equal to the cached value: that delivery clears error state.
 */
export function createPollingDeliveryTracker() {
  let fingerprint = null;
  let failed = false;
  return Object.freeze({
    accept(rows) {
      const nextFingerprint = JSON.stringify(rows);
      const shouldDeliver = failed || nextFingerprint !== fingerprint;
      fingerprint = nextFingerprint;
      failed = false;
      return shouldDeliver;
    },
    fail() {
      failed = true;
    },
  });
}
