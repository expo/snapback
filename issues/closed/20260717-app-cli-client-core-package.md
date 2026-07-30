# Lift the app-data client core out of demos/_kit into a package

**Status:** Resolved (2026-07-30)
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Lift the app-data client core out of demos/_kit into a package” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the fix requires a few coordinated implementation and test surfaces, with specific cited code, progress, or acceptance criteria.
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

## Resolution (2026-07-30)

All three done-when items hold; the final-revision deltas landed with the
lift.

**Item 1 (already landed earlier):** the client core lives in
`packages/snapback-client`; `demos/_kit/client.mjs` is a three-line
re-export shim — one source, no hand-synced copy, so no transitional
equality gate is needed.

**Item 2 — app-data-only façade:** `packages/snapback-client/app-data.mjs`
exports `SnapbackAppDataClient` (subpath `@snapback/client/app-data`, typed
by `app-data.d.mts`). It delegates the closed `APP_DATA_CLIENT_METHODS`
list — query/mutation/action/live/ephemeral call paths, sessions flow,
agent-fence integration, connection lifecycle — to an internal full client
constructed with `adminToken: null`, so the ambient
`process.env.SNAPBACK_ADMIN_TOKEN` constructor default never applies. Admin
and operator methods are absent by construction (not runtime-refused), and
passing an `adminToken` option — even `null` — is a `TypeError`. The engine
(`packages/snapback-app-cli/index.mjs`) now constructs the façade instead
of `SnapbackClient`. Planted-token proof in both packages:
`packages/snapback-client/app-data.test.mjs` and the extended
`packages/snapback-app-cli/package.test.mjs` plant
`SNAPBACK_ADMIN_TOKEN` and assert no captured request (URL, headers, or
body) carries it, with a detector-sensitivity case showing the same harness
does see the token when the full client's admin path sends it. The full
client's ambient default is deliberately retained for its legitimate
operator-plane consumers (kit server harness, demo admin flows) — the
ticket governs the façade and engine posture.

**Final-revision deltas:**

- *Bare artifact fetch path:* `fetchPublicArtifact(baseUrl, path)` in
  `app-data.mjs` — GET with `accept-encoding: identity`, `redirect:
  'manual'` with every 3xx/opaque-redirect a typed
  `SNAPBACK_REDIRECT_REFUSED`, no credential/cookie carrier of any class,
  and a `content-encoding` other than identity refused as
  `SNAPBACK_ARTIFACT_ENCODING_UNEXPECTED` — transformed bytes are never
  normalized into the expected envelope identity. The `/app-api/*` server
  routes remain their own phase-1 deliverable (LLP 0031 amendment); the
  path is tested against a stand-in HTTP origin.
- *Per-class decoded-byte ingress bounds:* `DEFAULT_INGRESS_LIMIT_BYTES`
  (appCall, authLifecycle, discovery, artifact, liveFrame) with a
  constructor `ingressLimits` override. HTTP responses are read through a
  streaming bounded reader in the client's single fetch choke point —
  counted on decoded bytes actually received, before text/JSON
  materialization, catching dishonest `Content-Length`, chunked bodies,
  and decompression expansion — refusing with typed
  `SNAPBACK_INGRESS_LIMIT_EXCEEDED` (transport-class, sub-cause carries
  the class). WebSocket frames are bounded at both decode sites before
  `JSON.parse` (binary frames on exact byte length; text frames on the
  UTF-16 code-unit proxy); the managed live socket closes an oversized
  frame as 1009 so ordinary loss/reconnect policy owns recovery.
- *Redirect-terminal credentialed requests:* every request whose headers
  or body carry a request secret (the existing `collectRequestSecrets`
  taxonomy: authorization/admin/connection-token headers,
  secret-classified body fields) is issued with `redirect: 'manual'` and
  any redirect response is a terminal `SNAPBACK_REDIRECT_REFUSED`;
  credential-free requests keep platform redirect behavior.

**Item 3 — suites:** `@snapback/client` full suite (19 test files + tsc
fixture) passes; `@snapback/app-cli` passes; `@snapback/react` (4 suites)
and `@snapback/vite` (12 tests) pass; todo headless demo acceptance passes
24/24 unchanged (including websocket live paths) against a configured
server binary. `scripts/check-package-test-inventory.mjs` updated
(124 → 125). `./ref-check --verbose` clean.
`packages/snapback-cli/comparator-profile.test.mjs` fails in the fresh
worktree identically with and without this change (missing
`packages/snapback-runtime-darwin-arm64/bin/snapback`, an
environment-only release-build prerequisite) — not a regression.

Known limits, stated: WS text-frame bounds use the code-unit proxy (exact
bytes for binary frames); opaque credential-response paths (`authRequestCode`
etc.) keep their by-design opaque failure and so mask the ingress sub-cause;
`fetchPublicArtifact` awaits real `/app-api/*` routes for end-to-end
served-artifact witnesses (tracked by the phase-1 program tickets).
