# all-aboard remote acceptance: directions check depends on OpenRouteService being up

**Opened:** 2026-07-25
**Systems:** Cloudflare arm, All Aboard demo, acceptance suites

While verifying the 511 service-hours fix
(`issues/closed/20260725-all-aboard-511-service-hours-false-negative.md`),
the trailing "directions key usage returns a live route estimate" check in
`cloudflare/test/acceptance.remote.all-aboard.mjs` hit a real
OpenRouteService outage as seen from the worker's egress (~04:45 PT):
repeated probes of the deployed `routeEstimate` action returned either
`{ ok: false, diagnostic: { code: 'SNAPBACK_ACTION_TIMEOUT' } }` (30s
wall-clock budget, no `result`) or a fast `haversine-fallback` result
carrying `HTTP 502 from https://api.openrouteservice.org/...` — while a
direct unauthenticated probe from the dev machine answered 401 (host up,
auth required), so the failure was specific to the worker-egress path or
an ORS partial outage.

Two findings:

1. **Crash fixed (this commit):** the check's detail template dereferenced
   `route.result.source` unconditionally; an `ok:false` timeout envelope
   has no `result`, so the suite died with
   `TypeError: Cannot read properties of undefined (reading 'source')`
   instead of failing the check cleanly (and the two checks after it never
   ran). The detail is now null-safe and surfaces the diagnostic code and
   any fallback error; the check's pass condition is unchanged.

2. **Open question:** the check still hard-fails on a genuine third-party
   outage, making the suite dependent on ORS availability the same way it
   used to be dependent on Caltrain service hours. Unlike the 511 case
   there is no "honest zero" to soft-pass on — a fallback result proves
   nothing about the directions key — so any soft-pass here would weaken
   the key-usage evidence. Options: leave as-is (an outage is rare and the
   failure now reads cleanly), or gate a soft-pass on the fallback error
   being an upstream 5xx/timeout WITH the config check having attested the
   key as set. Needs an author call; leaving as-is until then.
