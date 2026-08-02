# Guide gap: signed-out asset byte fetch is HTTP 400, not 401/403 — say so

**Status:** CLOSED — from the round-2 party-wall fresh builder (build-log
stumble 5, diaries/0049 round-2 entry)

A signed-out (no-credential, no-protocol-offer) fetch of a
`private-strict` asset URL returns HTTP 400
(`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`), not 401/403 — by design:
a request without the client-protocol offer is malformed before it is
unauthorized, per the sessions overlay's body/header rules. Both round-2
fresh builders expected 401/403 and spent a stumble discovering the
posture experimentally.

Fix shape (docs only): one paragraph on guide/backend/assets.md §Deliver
(or the client-protocol page's status table) stating the 400-before-401
ordering for protocol-less requests on strict lanes, with the
pasteable-lane contrast (public/signed delivery routes are exempt from
the protocol offer and return ordinary 200/403/404 semantics to plain
HTTP clients). Cross-reference the reviewed status tables in LLP 0012.

## Resolution

Fixed 2026-08-01 in `guide/backend/assets.md` §Deliver. The page now states
that a sessions-mode `private-strict` byte request without the auth-client
protocol offer is malformed before authorization, returns HTTP 400 with
`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`, and needs
`x-snapback-auth-client-protocol: 1`. It contrasts the pasteable public and
already-issued signed lanes, which need no offer and keep ordinary
200/403/404 delivery semantics, and links LLP 0012 plus LLP 0096 as the
governing status/profile contracts.

The generated guide manifest and flat projection were refreshed, and
`node scripts/check-guide.mjs` passes.
