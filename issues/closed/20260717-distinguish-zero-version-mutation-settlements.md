# Distinguish authoritative version-zero mutation settlements

**Status:** Closed
**Severity:** P2
**Systems:** Storage, Offline replay, Mutation receipts
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0007; LLP 0043; `issues/closed/20260717-refuse-storage-version-exhaustion.md`
**Marker:** settlement, replay, version-zero, migration, corruption

`_snapback_client_mutations.settled_version = 0` represented two different
facts: an old row upgraded from before settlement metadata and a newly recorded
no-op mutation whose legitimate storage head was zero. Replay and open-time
validation had to exempt the legacy sentinel, so they also exempted the new
authoritative zero. After a later commit advanced the head, corruption that
changed only the retained output version to another in-range value could be
republished without disagreeing with any checked metadata.

**Done when:**

- Every new settlement, including a no-op at head zero, carries authoritative
  version metadata that is distinguishable from an upgraded predecessor row.
- Replay and database-open validation require authoritative metadata, the
  legacy cursor, and the output payload to agree exactly and remain in the
  portable version domain.
- Existing rows remain readable without backfilling authority from the output
  being checked.
- A deterministic test advances the head after a version-zero settlement,
  corrupts only its output cursor, and proves both live replay and reopen fail
  closed.

## Resolution

The replay ledger now has an additive nullable `settled_version_exact` column.
New settlement inserts write the output cursor into both version columns;
`NULL` alone identifies a predecessor row. Exact rows require all three durable
representations to agree, including at zero. Upgrade deliberately leaves old
rows null rather than copying their replay output into purportedly independent
metadata. Malformed exact values and the exact-zero drift case have focused
regressions.

Focused proof on 2026-07-17:

- `cargo test --lib exact_zero_settlement_rejects_output_version_drift_live_and_on_reopen -- --nocapture` — passed.
- `cargo test --lib retained_mutation_replay_rejects_corrupt_version_metadata -- --nocapture` — passed.
- `./ref-check --verbose` — 63 LLP documents and 1,372 references passed with
  0 errors and 0 unchecked references.
