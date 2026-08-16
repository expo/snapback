# React provider never sends the auth-invalidation protocol; packed starter live path 400s and blocks the fastpath release

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** React client, Auth, Templates, Packaging, Release
**Date:** 2026-08-16
**Found while:** 0.1.24 fastpath release attempt — the cold-install gate
(`proveOneCommandReactStarter`) timed out on `Connection: live` at two
different cut revisions and locally

## Diagnosis (complete, reproduced live)

In the packed react starter (cold-install `--keep` scaffold), the app loads
and renders, `/connection/open` returns 200 and the live socket opens, but
every `/__snapback/live/listTodos/subscribe` POST returns **400**:

```json
{"code":"SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED",
 "message":"add the request header `x-snapback-auth-invalidation-protocol: 1`
 (or configure SnapbackClient with `authInvalidationProtocol: 1`): auth-scoped
 live work requires the exact authorization-invalidation protocol",
 "details":{"capability":"authScopedLive","minimumAuthInvalidationProtocol":1}}
```

The client retries forever; the UI stays `Connection: idle`; the cold-install
browser proof times out waiting for `Connection: live`. Reproduced end to end
on the kept scaffold (packed packages `0.1.0-local-ci.2`, packed runtime,
attach-shape vite plugin) — not a Vite/relay/dev-identity issue (those were
eliminated first: page 200, open 200, prebundle exports intact).

`packages/snapback-react`'s own tests default
`authInvalidationProtocol = 1` and wire it via
`authProtocols: { authInvalidation: 1 }` (package.test.mjs:99-126), but
neither `SnapbackProvider` nor the react template's `main.tsx` passes it, so
every real consumer app hits the server's auth-scoped-live requirement
unarmed.

## Decision needed (owning auth/invalidation lane)

Either the provider defaults the protocol when the generated app is
sessions-mode (systemic; matches the tests' default and spares every
consumer), or the template passes it explicitly (localized; every existing
external app stays broken). The provider default looks right — the server
names an exact protocol version, and the client library already implements
it — but that is the invalidation lane's contract to rule.

## Consequences while open

- The qualified fastpath release is **blocked**: the cold-install gate
  cannot pass at any current revision. (0.1.24 attempt otherwise fully
  staged: preflight green, public-package release build, pass-1 identity
  staging green, darwin store receipt mintable; linux artifact recipe =
  pin-branch dispatch of linux-runtime-package.yml.)
- Published `latest` (0.1.23) has the mirror-image skew: its
  `@expo/snapback-react` predates `useSnapbackAuth`, so the current react
  template cannot run against published packages at all — one more reason
  the next qualified release should follow promptly once this closes.

## Repro

Cold-install `--keep`, then in the kept `partitime-external/react-starter`:
`rm -rf .snapback && npm run dev`, open the vite origin with Playwright,
observe the subscribe 400 loop. Receipts and the full probe transcript in
the session ledger (2026-08-16).
