# Lift the app-data client core out of demos/_kit into a package

**Status:** Open
**Severity:** P2
**Systems:** Client integration, Packaging
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0062 §1/§6, LLP 0012 (packaging bar: real, typed, versioned packages)
**Marker:** app-cli, sub-stage-a

The headless `SnapbackClient` lives at `demos/_kit/client.mjs` with no
`package.json`, so nothing outside the demos tree can declare a
dependency on it. LLP 0062's engine (`packages/snapback-app-cli`) needs
the app-data subset as a real dependency — and needs it as an
**app-data-only façade**: the full client ambiently reads
`SNAPBACK_ADMIN_TOKEN` (client.mjs constructor default) and exposes
operator methods, both of which the app CLI must not have by
construction (LLP 0062 §Position).

Final-revision deltas: the kit re-exports the lifted package (one
source; CI equality gate during transition — never a hand-synced
copy); the façade provides a bare, credential-free, non-redirecting
fetch path for public artifact routes; parent-side ingress limits
(per-class decoded-byte bounds before materialization) and
redirect-terminal credentialed requests land with the lift.
The artifact path explicitly requests identity encoding and rejects
unexpected content coding; it never normalizes transformed bytes into
the expected envelope identity.

**Done when:**

- The app-data client core (query/mutation/action/live/ephemeral call
  paths, sessions flow, agent fence integration) is importable from a
  real package under `packages/`, with `demos/_kit` consuming it (no
  fork).
- The exported façade used by the engine has no admin methods and no
  ambient `SNAPBACK_ADMIN_TOKEN` pickup; a test constructs it with the
  env var planted and proves no request carries it.
- Existing demo acceptance suites pass unchanged against the lifted
  core.
