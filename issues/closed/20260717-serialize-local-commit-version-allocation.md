# Serialize local commit-version allocation

**Status:** Closed
**Severity:** P1
**Systems:** Storage, Mutations, Seeds, OCC, Change journal
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0007; LLP 0032
**Marker:** sqlite, commit-version, writer-reservation, journal, ordering

The local SQLite write paths read the current global version and derived their
successor before beginning a write transaction. Two `LocalDatabase` instances
could therefore allocate the same successor, then serialize their writes while
publishing duplicate commit versions and a non-advancing global head.

**Done when:**

- Seed preview, seed commit, HostPlan commit, and buffered-Ibex commit acquire
  SQLite's writer reservation before reading or advancing the global head.
- Concurrent writers publish unique, monotonic versions and matching row and
  journal versions.
- A deterministic two-writer rendezvous proves the second writer allocates
  only after the first writer's committed successor is visible.

## Resolution

All four app-write paths now begin an `IMMEDIATE` transaction before reading
the global head. SQLite's single-writer reservation is therefore the local
version-allocation fence, and validation, row changes, journal entries, and the
head update remain in the same transaction.

The regression pauses the first connection only after `BEGIN IMMEDIATE` and
its predecessor read. A zero-timeout sibling is refused at the reservation
boundary, then succeeds at version 2 after the first commits at version 1;
four rows carry the corresponding version set. Under the former ordering the
first connection would not own a writer reservation at the pause, so the
sibling could commit from the same sampled predecessor.
