// Provider-outage witness for the remote All Aboard directions check
// (issues/20260725-all-aboard-routeestimate-outage-fragility.md, finding 2;
// author decision 2026-08-01): the deployed check may record-and-skip ONLY
// when the worker's own egress proves OpenRouteService itself is down — the
// `routeEstimate` fallback carrying an upstream 5xx from the ORS host, with
// the directions key already config-attested as set. Everything else keeps
// hard-failing: our-side errors (4xx from ORS means our key/request), action
// timeouts (ambiguous — could be our watchdog or worker), transport errors,
// and 5xx from any other host. No soft-pass on ambiguous results — a
// fallback result proves nothing about the directions key, so the skip is a
// recorded outage, never evidence.

// The exact error shape `fetchJson` in demos/all-aboard/snapback/handlers.mjs
// produces for an ORS server-side failure observed from the worker's egress.
export const ORS_UPSTREAM_5XX = /HTTP 5\d\d from https:\/\/api\.openrouteservice\.org\//;

// Classify one deployed `routeEstimate` envelope.
// Returns { verdict: 'pass' | 'skip-provider-outage' | 'fail', witness }.
export function classifyRouteEstimateOutcome(route, { directionsKeyAttested = false } = {}) {
  if (route?.ok === true && route.result?.source === 'openrouteservice' && route.result.minutes > 0) {
    return {
      verdict: 'pass',
      witness: `${route.result.source}, ${route.result.minutes}min`,
    };
  }
  const fallbackError =
    route?.ok === true && route.result?.source === 'haversine-fallback'
      ? String(route.result.error || '')
      : '';
  if (directionsKeyAttested && ORS_UPSTREAM_5XX.test(fallbackError)) {
    return {
      verdict: 'skip-provider-outage',
      witness: `provider outage witnessed from worker egress (key attested set): ${fallbackError.slice(0, 200)}`,
    };
  }
  const observed = route?.result
    ? `${route.result.source}${route.result.error ? ` — ${route.result.error}` : ''}`
    : `no result: ${route?.diagnostic?.code || JSON.stringify(route)}`;
  return {
    verdict: 'fail',
    witness: directionsKeyAttested
      ? observed
      : `${observed} (directions key not attested set)`,
  };
}
