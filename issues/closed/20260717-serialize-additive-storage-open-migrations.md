# Serialize additive storage-open migrations

**Status:** Closed
**Severity:** P2
**Systems:** Storage, SQLite startup, Internal migrations
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0007; `issues/closed/20260717-reserve-sqlite-writer-before-maintenance-upgrades.md`
**Marker:** sqlite, migration, concurrent-open, alter-table, writer-reservation

Infrastructure upgrade read `PRAGMA table_info` in autocommit and later ran
separate `ALTER TABLE ADD COLUMN` statements. Two sibling openers could both
observe a missing column. Once the first committed its alteration, the second
acted on its stale observation and failed with `duplicate column name`.
`busy_timeout` can wait for the first writer but cannot refresh a decision made
before that wait.

**Done when:**

- Additive infrastructure column discovery and its dependent DDL share one
  `IMMEDIATE` SQLite transaction.
- Index installation joins the same transaction and no partially applied
  column/index group is published.
- Populated predecessor rows retain their exact bytes and gain no fabricated
  settlement provenance.
- A deterministic two-opener rendezvous proves the second opener reaches the
  migration while the first owns the writer, then re-reads the committed schema
  and succeeds.

## Resolution

Storage open now reserves the SQLite writer before reading internal mutation-
ledger columns, applies every missing column and both ledger indexes in that
transaction, and commits before the separately writer-reserved counter check.
The regression removes the newest nullable column from a populated fixture,
holds opener A after its writer reservation, starts opener B, and proves both
opens and legacy replay succeed with the migrated row still carrying `NULL`
provenance.

Focused proof on 2026-07-17:

- `cargo test --lib concurrent_reopen_serializes_additive_infrastructure_migration -- --nocapture` — passed.
- `cargo test --lib reopen_ -- --nocapture` — 11 passed, 0 failed.
- `cargo fmt -- --check` — passed.
