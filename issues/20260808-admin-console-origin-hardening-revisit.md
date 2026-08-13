# Admin console: revisit app-origin credential custody and loopback read exposure (documented tradeoffs)

**Opened:** 2026-08-08 · **Severity:** P3 (hardening; both are currently deliberate, documented tradeoffs — not defects) · **Area:** admin / auth

The admin console (`src/admin/setup.html`) reviewed clean on XSS: all rendering
goes through `textContent`/`setAttribute`, no `innerHTML`/`eval`/`document.write`,
a CSP with a pinned inline-script hash (recomputed and verified),
`frame-ancestors 'none'`, and a thorough client-side secret-redaction layer. The
master token transits only as a same-origin header and the legacy localStorage
token key is actively deleted. Two accepted tradeoffs are worth a tracked
revisit before the hosted/non-loopback posture widens.

## A) Derived admin bearer lives in localStorage on an origin shared with the app

`src/admin/setup.html:90, 219, 244-249`. The server serves the app at `/` and
admin at `/_snapback/*` on the **same origin**, and the console credential
(`snapback_console_credential_v1`) is stored in `localStorage` and replayed as
`x-snapback-console-credential` (accepted for AdminWrite,
`admin.rs:3618-3629`). Any XSS or malicious dependency in the *hosted app's*
pages can read and replay it until expiry. This is explicitly documented
(server.rs:8858-8861, `@ref LLP 0060#c2`, which states it does not claim the
headers make an app-origin-readable bearer XSS-proof) and the credential is a
short-lived derived `sbcc_` token specifically to bound the blast radius.
*Hardening:* move the credential to a `__Host-`-prefixed, `SameSite=Strict`,
`HttpOnly` cookie scoped to `/_snapback/`, or serve the admin console from a
distinct origin/port.

## B) Loopback binds expose admin *reads* to any localhost origin + DNS rebinding

`src/admin.rs:3401-3431` (`evaluate_access`: read = `loopback || token_ok`);
`src/server.rs:17374-17389` (`loopback_origin` reflects any
`localhost:*`/`127.0.0.1:*`/`[::1]:*` origin), 17280-17311 (CORS decorates,
never rejects). Any page from any other localhost port gets a reflected
`Access-Control-Allow-Origin` and can read `/_snapback/api/config/status`
(entry names, set/required/verified state), health, telemetry stats, error-issue
lists — no credential on a loopback bind. No HTTP `Host` validation found, so a
DNS-rebound page (`attacker.com → 127.0.0.1`) gets the same reads. Values are
never readable (no read-back exists) and writes still require the token. This is
deliberate (`@ref LLP 0017#security-defaults — loopback reads are convenient`)
but the read exposure to arbitrary localhost origins / rebinding is accepted
rather than argued. *Hardening:* require the console credential for admin reads
when one exists, or pin CORS to the instance's own origin + registered
reachability origins; optionally validate `Host`.

## C) App-manifest `acquisition.url` becomes an `<a href>` with no scheme allowlist

`src/admin/setup.html:415-423`; `src/manifest.rs:8249-8252` carries it verbatim.
A hostile manifest declaring `acquisition: { url: "javascript:…" }` is blocked
today only by the page CSP (defense-in-depth); `linkify()` (setup.html:311-322)
enforces `https?://` while this path enforces nothing. *Fix:* mirror `linkify`'s
`/^https?:\/\//` check.

## Confidence

High on all three mechanisms; A and B are explicitly documented tradeoffs (lower
confidence they're "wrong"), C is a small missing check with CSP backstop. File
as a revisit anchor, not an urgent defect.

## Progress (2026-08-08 Lane J) — part C fixed
Part C landed on main: src/admin/setup.html renders the app-manifest acquisition.url <a href> only for http(s) URLs (mirrors linkify), and src/server.rs SETUP_SCRIPT_SHA256 was recomputed so the CSP still matches (independently verified; CSP test passes). Parts A (app-origin console-credential custody) and B (loopback read exposure / DNS rebinding) remain OPEN as documented, author-gated hardening tradeoffs.

## Blast-radius note (2026-08-12 review)

Part B's missing Host check and loopback CORS reflection also reach surfaces this ticket did not list:

- Dev body `auth.userId` impersonation from any localhost origin — `issues/closed/20260812-dev-body-impersonation-loopback-cors.md`
- OAuth metadata `issuer` / token endpoints taken from request `Host` — `issues/closed/20260812-oauth-metadata-trusts-host-header.md`
- `POST /mcp` (`require_mcp_origin` allows any loopback Origin; missing Origin is fail-open for native clients)
- `POST /connection/open` (public capability grant)

A Host allowlist / CORS pin on the main listener should cover these together rather than per-route.
