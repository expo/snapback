# Serialize the Card Game authority fixture outside reservation contention

**Status:** Closed
**Severity:** P2
**Systems:** Card Game demo, Acceptance testing, Auth reservations
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0059
**Marker:** acceptance, auth, reservation, deterministic-test

The Card Game authority-scope acceptance test installed four independent hand
rows with `Promise.all`. Protected writes use a deliberately one-shot
authorization reservation: if another write changes the sampled durable
frontier before SQLite begins, the loser returns
`SNAPBACK_AUTH_RESERVATION_STALE` instead of rerunning potentially computed
handler effects. The test is about principal isolation, not concurrent
reservation retry, so its setup intermittently failed for an allowed outcome.

**Done when:**

- The authority-isolation fixture does not create unrelated reservation
  contention.
- Any pre-transaction reservation retry uses the same durable client-mutation
  identity and the same authority capture.
- No retry may reinterpret a fixture mutation under an authority successor.
- The same two-principal row-stamping and isolation assertions remain intact.
- The Card Game authority-scope acceptance scenario passes repeatedly.

## Resolution

The fixture now installs its authority-stamped rows serially and assigns each
one a stable `clientMutationId`. A bounded helper retries only the typed
pre-transaction reservation-stale outcome, after a fresh coordinated authority
read, and requires the original authority capture to remain current before
using that same identity. Every mutation attempt also passes the original
capture into the client's final durable/start fence, closing the successor race
between the explicit check and transport initiation. Client-authority staleness
is never retried because it may name a real successor. The concurrent read and
cross-principal isolation assertions remain unchanged. This preserves the
test's security claim without weakening the one-shot reservation contract or
introducing a cross-authority mutation retry.
