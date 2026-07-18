# Pin storage race regressions to their true concurrency boundaries

**Status:** Closed
**Severity:** P2
**Systems:** Storage, SQLite, Database open, Testing
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; issues/closed/20260717-accept-valid-head-advance-during-storage-open.md; issues/closed/20260717-serialize-additive-storage-open-migrations.md
**Marker:** storage, sqlite, concurrency, regression, rendezvous

The first regressions for two storage-open race fixes did not rendezvous at the
boundaries their names claimed. The sibling-head test paused the final
validation snapshot rather than the mutation-free preflight, so it would pass
with the old head-equality bug. The migration test observed opener B at
`create_infra` entry, before substantial work preceding `BEGIN IMMEDIATE`, so it
did not prove that a stale pre-reservation column inspection was impossible.

**Done when:**

- The sibling writer commits N+1 after the opener has pinned the initial
  mutation-free preflight and before migration/final validation.
- Migration-attempt instrumentation fires immediately before writer
  acquisition and acquisition instrumentation fires before column discovery.
- While opener A is paused after acquisition, opener B reaches that exact
  boundary and a zero-timeout raw `BEGIN IMMEDIATE` proves A still owns the
  SQLite writer reservation.
- Both focused regressions execute and pass.

## Resolution

The preflight now invokes the test-only pinned-snapshot rendezvous immediately
after reading the canonical head. The additive-migration hooks now surround the
actual `BEGIN IMMEDIATE`, with column discovery occurring only after the
acquired hook. The concurrency test advances opener B to that boundary, proves
A's reservation using an independent zero-timeout SQLite connection, then
releases A and verifies both openers observe the migrated schema. These tests
now fail for the corresponding pre-fix implementations rather than merely
exercising nearby concurrency.

Focused proof on 2026-07-17:

- Both named concurrency regressions passed with `--nocapture`.
- `cargo test --lib reopen_` — 11 passed, 0 failed.
- `cargo test --lib exact_zero_settlement_rejects_output_version_drift_live_and_on_reopen` — passed.
- `cargo fmt -- --check` — passed.
