# LLP 0031 lacks the landed `/app-api/*` route-class registration

**Status:** Open
**Opened:** 2026-08-04 (Linear cleanup; residual from ENG-25407)
**Systems:** API envelope, Route registry, Documentation

LLP 0062 Phase 1 and the `/app-api/*` implementation are complete, but the
dated LLP 0031 amendment promised by the phase program never landed. The code
and route-policy tests already cover:

- `GET /app-api/current` as the sessions-only, no-store discovery route;
- `GET /app-api/envelope/{sha256}` as the content-addressed public projection;
- the lowercase-SHA grammar, identity content coding, strong ETag,
  `Content-Digest`, immutable/no-transform success caching, typed misses, and
  the GET/HEAD/304/OPTIONS/error header matrix.

The remaining work is documentation reconciliation, not route implementation:
add the dated route-class registration to
`llp/0031-server-route-taxonomy.spec.md`, align LLP 0062's 2026-07-23
disposition table with the landed Phase-1 state, and run `./ref-check
--verbose`. Preserve the distinction between `PublicNoStore` discovery and
the immutable `PublicProjection` envelope artifact.

Repository evidence: `issues/closed/20260801-0062-02-envelope-serving-ingestion.md`
records the server/engine landing and its green registry/digest-matrix proof;
`llp/0012-headless-integration-contract.spec.md` already registers
`AppApiDiscoveryV1`, the content-addressed envelope, and
`SNAPBACK_APP_API_*`.

## Resolution (2026-08-04)

Landed the dated LLP 0031 registration: both `/app-api/*` routes join
the system HTTP matrix (`PublicNoStore` discovery / `PublicProjection`
envelope, credential-free, registry-enforced) with the Revised entry,
and LLP 0062's stale "remain future work" parenthetical now records the
landing. ref-check green.
