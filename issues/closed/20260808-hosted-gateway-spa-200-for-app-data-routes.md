# P0: hosted gateway returns SPA index.html with HTTP 200 for unrouted app-data routes

**Status:** Open
**Opened:** 2026-08-08 · **Severity:** P0 · **Area:** cloudflare gateway / local 404 fallback / route parity fixture

From the 2026-08-08 agentic surface audit (LLP 0202 P0 #1 and theme 8).

1. **The P0.** `cloudflare/src/gateway.js:258` is an unconditional
   `return env.ASSETS.fetch(request)` after the `/_snapback/*` JSON-404 arm
   (`:180`). Any app-data route the gateway does not hand-route —
   `POST /auth/exchange`, `POST /ephemeral/publish`,
   `GET /assets/records/{id}/bytes/{v}`, `POST /push/tokens/register`,
   `GET /app-api/current`, `POST /client-mutations/acknowledge`, all present
   locally — returns `200 text/html` (the SPA's `index.html`) on hosted. An
   agent parsing JSON sees a success status and a non-JSON body: the exact
   `host-ops response was not JSON` failure class LLP 0193 records as
   costing a bisection session. Real divergence already exists:
   `/live/{name}/resume` is registered locally (`guide/surface-map.md:140`)
   but `KIT_ROUTE` (`gateway.js:68`) matches only `subscribe|unsubscribe`.
   Fix: extend the SPA-fallback-detection pattern already used for
   `/__exact/*` (`gateway.js:216-238`) to a known app-data prefix list
   (`/auth`, `/assets`, `/ephemeral`, `/push`, `/app-api`,
   `/client-mutations`, `/live`, `/outbox`, `/query`, `/mutation`,
   `/action`, `/connection`) returning a structured
   `SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET` JSON diagnostic.
2. **The local server has the inverse gap.** Unknown routes return a
   bodyless 404 with no diagnostic (`src/server.rs:14633`), while the hosted
   gateway's `/_snapback/*` arm returns structured `SNAPBACK_ROUTE_UNKNOWN`.
   Fix: replace the fallback with an `ApiError` carrying
   `SNAPBACK_ROUTE_UNKNOWN` plus nearest-path candidates from
   `route_registry()` (the candidate machinery exists for host-ops,
   `src/host_ops.rs:2598-2607`).
3. **Hosted discovery-surface blackout is undocumented.** On a
   hosted-serving instance every `SystemStatic`/`SystemApi` route (served
   guide, `/llms.txt`, control catalog, host-ops) returns an empty-body 404
   by deliberate LLP 0060 C2 design (`src/server.rs:9342-9346`,
   `:11248-11255`) — but `guide/index.md:30-33` promises the served guide
   unconditionally and `guide/deploying/cloudflare.md:184-193`'s non-claims
   list omits it. Fix: add the exclusion to both pages.
4. **The parity fixture is one-directional and time-frozen by its own
   admission.** `cloudflare/gateway-paths.inventory.json` `$schemaNote`:
   drift from a *new* hand-routed `gateway.js` case "is caught only by the
   next LLP 0016 reconcile audit, not by CI"; the fixture is a hand audit
   pinned at an `auditedAtCommit`, and covers system/control paths only.
   Fix: parse `FORWARDED_JSON_PATHS`/`KIT_ROUTE`/exact-path literals out of
   `gateway.js` in the generator (all top-level constants) and fail on any
   gateway literal absent from the fixture; extend scope to the app-data
   plane.

## Resolution (2026-08-08)

All four fixes landed in the working tree. `cloudflare/src/gateway.js` now
recognizes SPA HTML fallbacks under every audited app-data prefix and returns
a versioned HTTP 501 `SNAPBACK_ROUTE_UNSUPPORTED_ON_TARGET` envelope while
preserving real asset responses. `src/server.rs` now answers local unknown
routes with `SNAPBACK_ROUTE_UNKNOWN` and bounded nearest-path candidates from
`route_registry()`; the hosted disabled-operator surface still returns its
indistinguishable empty 404 for registered and unregistered `/_snapback/*`
paths. `guide/index.md` and `guide/deploying/cloudflare.md` record the hosted
discovery non-claim. Finally, the control-catalog generator now parses the
forwarded-path Set, kit regexes, app-data prefixes, and exact-path comparisons
from the gateway source, checks the expanded app-data inventory, and carries
negative drift tests for each source-literal family.
