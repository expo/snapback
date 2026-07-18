# Bind authorization reservation frontiers to one snapshot

**Status:** Closed
**Severity:** P1
**Systems:** Authorization, RBAC, Storage, Reservations
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0032; LLP 0053; LLP 0059
**Marker:** authorization, reservation, snapshot, data-version, auth-stream

Authorization reservation admission assembled the app-data head and durable
authorization witness with two independent storage calls. A commit between
them could produce a synthetic pair that never existed in one database
snapshot, weakening the meaning of later reservation revalidation.

**Done when:**

- The data head and authorization version used by one reservation are read in
  one durable SQLite snapshot.
- Missing or corrupt authorization metadata still fails closed.
- Existing callers consume the paired storage primitive rather than combining
  separate reads.
- A deterministic sibling commit between the pair's two logical reads can
  produce only an old/old snapshot followed by a fresh new/new snapshot, never
  an old/new synthetic pair.

## Resolution

`LocalDatabase::authorization_reservation_snapshot` now reads both frontiers
inside one deferred transaction and returns them as a pair. `LocalSnapback`
delegates reservation sampling to that primitive, preserving the existing
fail-closed authorization-version decoder while ruling out synthetic
cross-commit pairs.

The regression pauses after the data head pins, commits a sibling write to a
permission-backing table, and proves the in-flight pair remains predecessor /
predecessor while the next sample observes successor / successor.
