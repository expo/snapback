# admin-ui CSP browser smoke fails on main: credential exchange refused

**Opened:** 2026-08-04
**Status:** Closed
**Resolved:** 2026-08-04
**Systems:** Admin console, Auth

`admin-ui` `bun run test:browser-security`
(`tests/acceptance/csp-browser.mjs`) fails on clean origin/main
(observed at d4d480492 with an untouched `dist` rebuild): the Chromium
boot reaches the token prompt but the credential exchange refuses with
`SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID` and the console API calls
403 with `SNAPBACK_ADMIN_DISABLED: admin API is disabled on this
non-loopback bind without a valid admin token` — despite the server
binding 127.0.0.1. Reproduced identically with and without unrelated
console changes, so this predates the LLP 0167 console work.

Likely related to the 2026-08-03 admin console access program
(`snapback admin`/approve/link). Either the smoke needs updating to the
new credential flow, or the flow regressed for the smoke's headless
path. The rest of the console suite (including `dev-serve-react-esm`)
is green.

Done means: `bun run test:browser-security` passes on main, or the
smoke is updated/retired with a stated replacement.

## Resolution (2026-08-04)

This was a stale-smoke bug, not a product regression. At the reported
`d4d480492` snapshot the smoke built its browser origin as
`http://127.0.0.1:<port>`, but spawned Snapback with `--host 0.0.0.0`.
Connecting to a wildcard listener through its loopback address does not make
the listener a loopback bind: `ServerContext` correctly recorded
`loopback = false`, so the LLP 0017 console-mint posture refused the exchange
before the valid master token could authorize it. The admin client
intentionally collapsed that credential-issuer refusal to
`SNAPBACK_AUTH_CREDENTIAL_RESPONSE_INVALID`; subsequent console requests had
no derived `sbcc_` credential and surfaced `SNAPBACK_ADMIN_DISABLED`.

Commit `f3270c84b` had already corrected the smoke to spawn the real current
flow on `--host 127.0.0.1`, with the master-token-to-derived-credential
exchange and all CSP/Trusted Types assertions intact. No product behavior or
security policy changed, and no test-only bypass was added. The existing
non-loopback refusal and credential-response validation remain unchanged.

Verification in this sandbox rebuilt the admin dist successfully (175
modules), passed the nine socket-free admin UI test programs, and passed 13
socket-free route-policy tests, including the console claim and reachability
policy cases. `scripts/bootstrap-ibex-runtime` also passed exact link, launch,
and restricted handler-VM qualification against the pinned Ibex revision.
The exact browser command and every listener-dependent Rust/Node test were
attempted but blocked at setup by sandbox `listen EPERM`; rerun
`bun run --cwd admin-ui test:browser-security` on a socket-capable host for
the terminal Chromium result.
