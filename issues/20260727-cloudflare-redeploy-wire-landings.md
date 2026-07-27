# Redeploy the shared Cloudflare deployment with the 2026-07-27 wire landings

**Status:** Open (operational step; coordinate with concurrent sessions
before deploying — the shared deployment also serves live demo traffic)
**Opened:** 2026-07-27
**Systems:** Cloudflare arm, Deployment
**Related:** LLP 0094 §0B.5/§0C.6/§0F;
issues/closed/20260725-0093-p0-wire-version-negotiation.md;
issues/closed/20260725-0094-hosted-response-shape-divergences.md;
issues/closed/20260725-0093-p0-marker-envelope-schemas.md

The shared Cloudflare deployment still serves pre-2026-07-27 worker bytes.
Three landings changed what the hosted arm serves and all deliberately
stopped short of deploying:

1. **Wire-version negotiation B1** (`kitOpenConnection` offer matrix +
   `ConnectionGrant.wireVersion` echo, socket-offer refusals, §0C.5
   `authInvalidationProtocol` alignment). Until this deploys, kits offering
   `wireVersion` against the shared deployment take the §0B.6 legacy-server
   fallback path (harmless but observable as the
   `SNAPBACK_CLIENT_WIRE_VERSION_DOWNGRADED` diagnostic).
2. **§0C.6 response-shape convergence** (mutation receipt, unsubscribe
   shape, full `Diagnostic` envelopes, kit-dialect in-band replies).
   Clients targeting the shared deployment MUST tolerate the old shapes
   until this deploys.
3. **Schema/gate work** — no served-bytes change, but the deployment
   identity files changed; the redeploy picks up the regenerated identities.

Steps: coordinate a window (no concurrent matrix runs or demo reruns),
`wrangler deploy` per the cloudflare README for both workers, then re-run
the hosted acceptance checks against the live origin and record the result
here. After the redeploy, delete the LLP 0094 §0C.6 "shared deployment
serves pre-convergence bytes" caveat.
