declare const __PARTITIME_PERFORMANCE_WITNESS_ORIGIN__: string;

type PartitimePerformanceGlobal = typeof globalThis & {
  __partitimeReportFirstAuthoritativeData?: (
    backend: string,
    rowCount: number,
  ) => void;
};

const performanceGlobal = globalThis as PartitimePerformanceGlobal;
const launchId = `exact-ios-${Date.now()}`;
let reported = false;

// This module is imported only by main.native.performance.ts. Its bytes stay
// inside the measured product HBC; the ordinary app and shared Exact runtime
// do not acquire a measurement-only network side channel.
performanceGlobal.__partitimeReportFirstAuthoritativeData = (
  backend,
  rowCount,
) => {
  if (reported) return;
  reported = true;
  const body = JSON.stringify({
    schemaVersion: 'partitime.native-product-marker.v1',
    profileId: 'exact-contract/ios',
    capabilityClass: 'Online',
    launchId,
    event: 'first-authoritative-data',
    details: { backend, rowCount },
    atMs: Date.now(),
  });
  void deliver(body);
};

async function deliver(body: string): Promise<void> {
  const origin = __PARTITIME_PERFORMANCE_WITNESS_ORIGIN__.replace(/\/$/, '');
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${origin}/event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (response.ok) return;
    } catch {
      // The witness is measurement telemetry and cannot affect product data.
    }
    if (attempt < 3) {
      await new Promise<void>((resolveRetry) => {
        globalThis.setTimeout(resolveRetry, attempt * 50);
      });
    }
  }
}
