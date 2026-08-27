# The shared development broker is unreachable from Expo web: no CORS on its JSON routes

- Status: Resolved
- Date: 2026-08-26
- Systems: `packages/snapback-cli` (`shared-development-broker.mjs`, `expo-dev.mjs`)
- Governing: LLP 0151 §Shared development browser Adapter
- Found by: driving the `expo-chat` provider buttons in a real browser
  (Chrome via CDP) against `snapback dev --expo --expo-platform web`

## What happens

The provider entry renders correctly and both entries resolve
`snapback-shared-browser · rehearsal · ready`. Clicking **Continue with Apple**
puts `Failed to fetch` on screen and nothing else happens.

The app is served from the supervised Metro front origin
(`http://127.0.0.1:4387`); the broker is mounted on the bootstrap origin
(`http://127.0.0.1:4386`). Different port, different origin. The adapter's
first call is `POST /v1/shared/start` with `content-type: application/json`,
which makes the browser send a CORS preflight first:

```
$ curl -i -X OPTIONS http://127.0.0.1:4386/v1/shared/start \
    -H 'Origin: http://127.0.0.1:4387' \
    -H 'Access-Control-Request-Method: POST' \
    -H 'Access-Control-Request-Headers: content-type'
HTTP/1.1 400 Bad Request
{"ok":false,"diagnostic":{"code":"SNAPBACK_AUTH_SHARED_DEVELOPMENT_REFUSED",
 "message":"/v1/shared/start requires POST","details":{"reason":"method-not-allowed"}}}
```

No `access-control-allow-*` header on that response, and none on the POST
response either. The browser therefore never sends the POST, and the adapter
sees a network failure it cannot distinguish from the broker being down.

## Why it is structural, not incidental

`startBootstrapExchange` dispatches `/v1/shared/*` **before** applying its
bootstrap CORS projection, deliberately (`expo-dev.mjs`):

> These routes are checked before the bootstrap CORS projection is applied,
> because the JSON routes are app-facing and the HTML route is same-origin by
> construction.

and the broker repeats the assumption:

> Browser-originated cross-origin calls are refused outright: the JSON routes
> are app-facing, and the HTML route is same-origin by construction.

That holds for Expo Go, where the app is a React Native runtime with no CORS
enforcement. On Expo web the app *is* a browser at a different origin, so the
JSON routes are browser-facing and the assumption inverts.

This contradicts the design, which puts web in scope: LLP 0151 says the shared
Adapter "uses the external-user-agent completion flow on native and the
server-callback flow on web", and the supervisor already derives and allowlists
the web return targets (`http://127.0.0.1:4387/auth/shared`,
`http://localhost:4387/auth/shared`) alongside the `exp://` ones.

## Why no existing check caught it

Every proof of this path stubs the browser:

- `packages/snapback-expo/shared-browser-adapter.test.mjs` injects a fetch stub.
- The `shared-provider-sign-in` acceptance check in the `expo-chat` template
  drives the real broker over Node `fetch`, which does not enforce CORS.
- `snapback auth status` observes the broker from a process, not a page.

The browser is the component that enforces this, so a proof that stubs the
browser cannot see it. Any regression test for the fix has to assert on the
response headers, not on a successful round trip through Node.

## Suggested fix

Give the broker the same exact-origin CORS projection the bootstrap exchange
already implements, scoped to the origins it already trusts:

- derive admitted browser origins from the http(s) entries of the return-target
  allowlist the broker is constructed with (no new configuration, no wildcard);
- on `/v1/shared/start` and `/v1/shared/redeem`, when `Origin` is exactly one
  of those, set `access-control-allow-origin`, `vary: Origin`,
  `access-control-allow-methods: POST, OPTIONS`,
  `access-control-allow-headers: content-type`, and answer `OPTIONS` with 204;
- leave every other case exactly as it is today: an unlisted `Origin` gets no
  CORS headers (the browser blocks it) and requests with no `Origin` — native,
  and the acceptance harness — are unaffected.

The authorize (HTML) and complete (form POST) routes stay same-origin by
construction and need nothing.

## Resolution (2026-08-26)

Three things stood between the rendered button and a session, each invisible to
every existing check because all of them stub the browser.

**1. No CORS on the JSON routes.** Fixed as suggested above: the broker derives
its admitted browser origins from the http(s) half of the return-target
allowlist it is already constructed with, answers the preflight with 204, and
echoes the exact origin on `start`/`redeem` and on their refusals. An origin the
supervisor did not derive still gets nothing, and requests with no `Origin`
(native, and the acceptance harness) are untouched.

**2. The authorization page's own CSP blocked the completion.** With CORS fixed,
the popup opened and consent posted, but the page never navigated. `form-action`
governs where a form submission may *end up*, redirects included, and the policy
named `'self'` only — so Chrome blocked the 303 to the app's origin while every
server-side check passed (`curl` completed the same transaction happily). The
policy now names `'self'` plus the same allowlisted return origins. No wildcard;
`exp://` targets are not form destinations and are not included.

**3. The web callback was never handed back to the opener.** The redirect then
landed on `http://127.0.0.1:4387/auth/shared?code=…&state=…`, which loads the
same app bundle in the popup — and nothing told the opener it had arrived, so
the attempt hung with the popup open. `resolveExpoSharedBrowserModules` now
calls `maybeCompleteAuthSession` when a `location` exists, which closes the
popup and resolves the attempt. Putting it in the package rather than in app
code keeps the one-method promise: an app does not have to know this incantation
to use `auth.signIn`. Verified both ways — with the call in the app's `App.tsx`
and, after moving it into the package, with no app-side call at all.

## Verified end to end in a browser

Chrome driven over CDP against a freshly scaffolded `expo-chat` app under
`snapback dev --expo --expo-platform web`: click **Continue with Apple** →
supervisor authorization page → consent → popup closes → app shows
`Signed in as usr_1zyz6fgdqbzqyh94natfr610y8`. Repeating the flow returns the
same principal, which is the app-scoped rehearsal identity behaving as designed.

Regression tests assert the headers rather than a round trip, because a Node
round trip passes either way: `shared-development-broker.test.mjs` covers the
preflight, the echoed origin, the refused foreign origins, and the `form-action`
contents; `shared-browser-adapter.test.mjs` covers the completion call and its
absence off web.

Related: `issues/20260826-supervised-web-signout-wedges-next-boot.md`, found
while repeating this flow.
