# Advertise registered DELETE routes in loopback CORS preflight

**Status:** Closed
**Severity:** P2
**Systems:** HTTP server, CORS, Auth grants, Browser clients
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0025 §Demo shape, LLP 0031 §Enforcement
**Marker:** bug

The route registry installs two session-authenticated `DELETE` operations:
`/auth/grants/{id}` and `/auth/grants/by-actor/{actor_id}`. The loopback CORS
middleware advertises only `GET, POST, OPTIONS` in
`Access-Control-Allow-Methods`. A browser app served from an ordinary
localhost/Vite origin therefore fails its DELETE preflight before the request
can reach grant revocation.

The method list is currently a second hand-maintained description of the HTTP
surface and can drift again as the registry grows.

**Done when:**

- A loopback-origin preflight with
  `Access-Control-Request-Method: DELETE` succeeds for both revocation routes.
- Disallowed origins remain closed and unknown paths do not gain operations.
- Allowed methods are derived from, or mechanically checked against, the route
  registry rather than maintained as an unrelated string literal.
- A black-box CORS test covers every registered method class.

## Resolution

`Access-Control-Allow-Methods` is now a cached projection of the authoritative
route registry, with HTTP's derived `HEAD` plus `OPTIONS`. Black-box preflight
coverage proves both grant-revocation DELETE paths work from an allowed
loopback origin, the complete method set matches the registry, and an unknown
path remains 404.
