# Offering the optional authorized-lease protocol makes the backend reject ordinary non-retainable live queries

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lane `sol-snapback-explicit` (0.1.21) ·
**Systems:** Protocol, Live queries, Client

## Problem

When the canonical client offered the optional authorized-lease protocol,
the 0.1.21 backend rejected every ordinary non-retainable live query — not
just lease-related endpoints. The lane's only viable configuration was to
omit the offer entirely. An optional protocol offer must degrade to a no-op
for requests that don't use it; instead it poisoned the session's ordinary
query path.

## Evidence

- `lanes/sol-snapback-explicit/diary.md` M2 ("Offering authorized leases
  from the canonical client caused the backend to reject every ordinary
  non-retainable live query, so that optional protocol offer is omitted")
  and `final-report.md` ("Protocol fallback").

## Suggested fix

Reproduce with a client that both offers leases and issues a non-retainable
live query in one session; fix the negotiation so the offer only affects
lease-scoped requests. Add a protocol-matrix test (offer × query
retainability) so the four combinations stay green.

## Resolution

Resolved 2026-08-15.

The canonical client was treating `authorizedLeaseProtocol: 1` as both a
session capability offer and per-query retention admission. With a durable
store and deployment identity, that promoted every generated protected live
query into protected-custody preparation even when its generated reference had
no retainable class. After the ordinary subscription succeeded, the client
therefore issued `POST /query/ordinaryRows/authorized-lease`; the backend's
correct per-query admission returned HTTP 400
`SNAPBACK_AUTHORIZED_LEASE_QUERY_NOT_RETAINABLE`.

Protected-custody preparation now additionally requires the generated
`opaque-authorized-snapshot-v1` retention class. The protocol offer only makes
lease custody available; non-retainable queries use the ordinary online path
and never call the lease endpoint. The four-cell matrix in
`packages/snapback-client/rqs-resume.test.mjs` covers lease offered/absent ×
retainable/non-retainable and asserts both usable online rows and the exact
lease-request/refusal behavior. The pre-fix offered/non-retainable cell failed
with the route and diagnostic above; all four cells pass after the fix, and the
existing cold protected-retention witness still passes.

The other optional offers were audited at their client promotion points.
Auth-invalidation is intentionally live-scoped, authority-descriptor is
mutation/ack-scoped, and ephemeral authority/expiry are connection/ephemeral
scoped. None shared the lease offer's use as an undeclared per-query retention
selector, so no sibling ticket was needed.
