# Preserve cold-query validity after unrelated pruning

**Status:** Closed
**Severity:** P2
**Systems:** OCC, Queries, Change journal, Retention
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0008; LLP 0020; LLP 0032
**Marker:** query, captured-read, global-cursor, retention, false-conflict

Snapshot-bound query dependencies now carry the global snapshot head rather
than a later per-table sample. For a cold table its preserved change
high-water may legitimately be lower than that global cursor. Validation only
fast-pathed equality, so after unrelated hot-table history raised the global
retention floor it could conservatively reject the cold dependency even though
the cold table provably had not changed after the query.

**Done when:**

- A table high-water at or below the snapshot's global cursor proves there was
  no later change to that table.
- Retention-floor conservatism still applies whenever the table high-water is
  newer than the sampled cursor and intervening history is unavailable.
- A regression captures an empty cold-table query, advances and prunes only a
  second table, and commits successfully with the cold dependency.

## Resolution

Captured-query validation now fast-paths `current_table_high_water <=
sampled_global_cursor`. The per-table high-water is monotonic because pruning
preserves each table's newest journal row; only a value greater than the
snapshot cursor can represent a relevant later table change. The regression
raises the retention floor solely through a hot table and proves the cold
query remains valid.
