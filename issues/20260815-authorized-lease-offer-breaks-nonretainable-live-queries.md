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
