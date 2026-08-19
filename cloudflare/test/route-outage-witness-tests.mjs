// Unit coverage for the directions provider-outage witness (author decision
// 2026-08-01 on issues/20260725-all-aboard-routeestimate-outage-fragility.md):
// proven ORS outage -> recorded skip; our-side failure -> fail; ambiguous ->
// fail; live estimate -> pass. Pure classification, no Miniflare.
import assert from 'node:assert/strict';

import { classifyRouteEstimateOutcome } from './route-outage-witness.mjs';

const attested = { directionsKeyAttested: true };

// Live estimate through the key -> pass.
{
  const outcome = classifyRouteEstimateOutcome(
    { ok: true, result: { source: 'openrouteservice', minutes: 42 } },
    attested,
  );
  assert.equal(outcome.verdict, 'pass');
  assert.match(outcome.witness, /openrouteservice, 42min/);
}

// Proven provider outage: fallback carrying an upstream 5xx from the ORS
// host, key attested -> recorded skip.
{
  const outcome = classifyRouteEstimateOutcome(
    {
      ok: true,
      result: {
        source: 'haversine-fallback',
        minutes: 55,
        error: 'HTTP 502 from https://api.openrouteservice.org/v2/directions/foot-walking?start=a&end=b',
      },
    },
    attested,
  );
  assert.equal(outcome.verdict, 'skip-provider-outage');
  assert.match(outcome.witness, /provider outage witnessed/);
  assert.match(outcome.witness, /HTTP 502 from https:\/\/api\.openrouteservice\.org\//);
}

// The same 5xx witness WITHOUT the attested key gate -> fail (the ticket's
// carve-out requires the config check to have attested the key as set).
{
  const outcome = classifyRouteEstimateOutcome(
    {
      ok: true,
      result: {
        source: 'haversine-fallback',
        error: 'HTTP 503 from https://api.openrouteservice.org/v2/directions/foot-walking',
      },
    },
    { directionsKeyAttested: false },
  );
  assert.equal(outcome.verdict, 'fail');
  assert.match(outcome.witness, /not attested/);
}

// Our-side failure: ORS answered 401 (our key/request is wrong) -> fail.
{
  const outcome = classifyRouteEstimateOutcome(
    {
      ok: true,
      result: {
        source: 'haversine-fallback',
        error: 'HTTP 401 from https://api.openrouteservice.org/v2/directions/foot-walking: Access token missing',
      },
    },
    attested,
  );
  assert.equal(outcome.verdict, 'fail');
}

// Ambiguous: action-timeout envelope with no result (could be our watchdog,
// our worker, or the provider — unprovable) -> fail, never a skip.
{
  const outcome = classifyRouteEstimateOutcome(
    { ok: false, diagnostic: { code: 'SNAPBACK_ACTION_TIMEOUT' } },
    attested,
  );
  assert.equal(outcome.verdict, 'fail');
  assert.match(outcome.witness, /SNAPBACK_ACTION_TIMEOUT/);
}

// Ambiguous: transport-level fallback error with no provable ORS status ->
// fail.
{
  const outcome = classifyRouteEstimateOutcome(
    { ok: true, result: { source: 'haversine-fallback', error: 'fetch failed' } },
    attested,
  );
  assert.equal(outcome.verdict, 'fail');
}

// A 5xx from any OTHER host proves nothing about ORS -> fail.
{
  const outcome = classifyRouteEstimateOutcome(
    {
      ok: true,
      result: {
        source: 'haversine-fallback',
        error: 'HTTP 502 from https://api.example.com/v2/directions',
      },
    },
    attested,
  );
  assert.equal(outcome.verdict, 'fail');
}

console.log('cloudflare route-outage-witness tests: proven-outage skip, our-bug fail, ambiguous fail');
