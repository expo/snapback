# Guide gap: signed-out asset byte fetch is HTTP 400, not 401/403 — say so

**Status:** OPEN — from the round-2 party-wall fresh builder (build-log
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
