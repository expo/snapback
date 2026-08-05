# admin-ui CSP browser smoke fails on main: credential exchange refused

**Opened:** 2026-08-04
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
