# Reserve the SQLite writer before maintenance upgrades

**Status:** Closed
**Severity:** P2
**Systems:** Storage, Mutation replay, Change journal, Maintenance
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0007; LLP 0008; LLP 0043
**Marker:** sqlite, busy-snapshot, maintenance, acknowledgement, retention

Several maintenance paths began a deferred transaction, read accounting or
journal state, and then attempted to write. With a second SQLite connection or
process, a commit after the first read makes that snapshot obsolete; upgrading
it to a writer can fail with `SQLITE_BUSY_SNAPSHOT`, and `busy_timeout` cannot
make an obsolete snapshot writable. The operation remained atomic but could
spuriously fail under ordinary sibling activity.

**Done when:**

- Client-mutation acknowledgement and administrative purge reserve the writer
  before reading counters or settlement rows.
- Change-journal pruning reserves the writer before reading the head, floor,
  and prunable range.
- Legacy retention-counter installation and transactional internal-index
  replacement do not perform deferred read-to-write upgrades.
- Existing accounting, journal, and migration proofs remain green.

## Resolution

Each read-then-write maintenance transaction now begins `IMMEDIATE`, including
the `&self` pruning path through `Transaction::new_unchecked`. SQLite therefore
queues or refuses at the transaction boundary before a snapshot is sampled,
instead of allowing work against a snapshot that can no longer be upgraded.
