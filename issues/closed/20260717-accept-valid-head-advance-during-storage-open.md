# Accept a valid head advance during storage open

**Status:** Closed
**Severity:** P2
**Systems:** Storage, SQLite startup, Version validation
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0007; `issues/closed/20260717-pin-head-bound-storage-reads.md`
**Marker:** sqlite, concurrent-open, snapshot, version-head, false-corruption

File open performed a mutation-free ordering preflight, ran additive
infrastructure work, and then required the final global head to equal the first
snapshot numerically. A valid sibling commit in that interval therefore caused
`SNAPBACK_STORAGE_VERSION_CORRUPT`, even though the final pinned validation
could prove the newer head, rows, journal, and retained ordering facts formed a
complete valid cut.

**Done when:**

- Corrupt predecessor state is still refused before any additive migration.
- Final open validation checks one complete current snapshot after migration.
- An intervening valid commit is accepted only when that newer complete cut
  validates; corruption at either boundary still fails closed.
- A deterministic test pauses the initial preflight, commits through a sibling
  writer, and proves reopen returns the newer exact state.

## Resolution

Open retains its pre-migration mutation-free validation and its final pinned
validation, but no longer treats numeric head inequality alone as corruption.
The final pass validates the complete current ordering cut. The regression uses
the storage snapshot rendezvous to pin the opener at version N, commits N+1 on
a sibling connection, and proves open succeeds with exactly the N and N+1 rows.

Focused proof on 2026-07-17:

- `cargo test --lib reopen_accepts_a_valid_sibling_commit_after_its_initial_preflight -- --nocapture` — passed.
- `cargo test --lib reopen_ -- --nocapture` — 11 passed, 0 failed.
- `cargo fmt -- --check` — passed.
