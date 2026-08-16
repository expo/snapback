# React provider never sends the auth-invalidation protocol; packed starter live path 400s and blocks the fastpath release

**Status:** Closed
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

## Resolution (2026-08-16)

The author ruled that authorization-invalidation v1 is a capability of the
client library, not an application or React-provider option. `SnapbackClient`
now advertises it by default at the same library boundary that owns the
auth-client protocol offer. `authInvalidationProtocol: null` remains an
explicit embedded-integration escape hatch for a legacy server; it removes
both the connection-open member and live request header, and sessions-mode
auth-scoped live work then refuses rather than degrading.

The security-relevant promise was verified before changing the default. The
library independently owns every v1 obligation: stable authorization
namespaces, invalidation handling on stream and poll deliveries, quarantine
before publication, snapshot replacement or terminal deletion before ACK,
per-scope high-water retention, and the authority barrier that synchronously
blanks memory and wipes the selected durable materialization on principal
change. No React callback or application cooperation is required.

The React live path now treats protocol/profile negotiation 400s—including
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`—as terminal for unchanged
mounted demand. It publishes the error, records it through the provider's
existing diagnostics surface, and installs no retry timer; ordinary transport
and readiness failures retain their bounded retry ladder. Client and React
wire regressions cover the default offer, explicit opt-out, provider
inheritance, terminal diagnostic, and absence of a retry loop. The starter
template needed no wiring change because the behavior is wholly inherited
from `SnapbackClient`.

Verification evidence and the one ambient React pretest qualification are
recorded in `report.md`.
