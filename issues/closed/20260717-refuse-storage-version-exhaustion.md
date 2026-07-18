# Refuse storage-version exhaustion before mutation work

**Status:** Closed
**Severity:** P1
**Systems:** Storage, Mutations, Ibex, Auth, Live queries
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0053; `issues/20260717-separate-managed-local-from-ephemeral-locks.md`
**Marker:** overflow, version, authorization, ordering

The seed, HostPlan, and buffered/Ibex mutation engines derived their commit
version with unchecked `current_version + 1`. The shipped plain-JSON wire can
represent only `0..=Number.MAX_SAFE_INTEGER` exactly; accepting a larger SQLite
integer aliases versions in JavaScript even long before `u64` arithmetic wraps.
Either outcome violates the monotonic version cut shared by change-log
ordering, live delivery, optimistic conflict checks, and authorization-room
settlement.

The storage layer already has a typed `SNAPBACK_STORAGE_VERSION_EXHAUSTED`
diagnostic for seed preview. Every mutation engine should use one checked
successor helper before opening or applying its write transaction, refuse with
that diagnostic, and preserve data, storage version, authorization version,
and live/auth side effects. The audit also found unchecked signed-to-unsigned
casts on membership/resource witnesses, membership transition records, expiry
sweeps, and the pruning high-water, plus a malformed retention floor that was
silently treated as zero during transactional conflict validation. Those are
part of the same durable-ordering boundary and must fail closed.

**Done when:**

- Seed, HostPlan, and buffered/Ibex commit paths use one checked successor
  helper and never perform unchecked version arithmetic.
- At `Number.MAX_SAFE_INTEGER`, each path returns
  `SNAPBACK_STORAGE_VERSION_EXHAUSTED` before applying writes or invoking an
  authorization commit hook; max-minus-one advances exactly once to max.
- Negative or greater-than-max durable predecessors fail live reads and file
  reopen with `SNAPBACK_STORAGE_VERSION_CORRUPT`.
- Negative, greater-than-max, or malformed persisted row/journal ordering facts
  fail their consuming read, RBAC plan, transition-log read, sweep, or prune
  before publishing an aliased cursor or changing retention state.
- Retained mutation output versions and settlement versions are decoded in the
  same domain and agree (apart from the documented legacy zero sentinel).
- Predicate reconstruction accepts only exact insert/update/delete operations,
  exact row ids and versions, object snapshots for writes, and no snapshot for
  deletes.
- Durable-version read failures produce typed diagnostics without zero/default
  cursors in receipts, live dependencies, invalidation witnesses, or host-ops.
- Journal pruning validates both its storage-version floor and caller-supplied
  timestamp before converting either to a SQLite integer.
- Every emitted storage/change/live version schema publishes the same maximum.
- Deterministic tests prove rows, storage version, and authorization version
  remain unchanged for all three paths.
- Focused Rust tests pass.

## Resolution

One portable-domain decoder now owns every durable storage-order read, and one
checked successor owns allocation for seed, HostPlan, and buffered/Ibex commits.
Database open validates the global predecessor before publishing a read lane.
Membership target/resource witnesses, transition audit records, expired-row
sweeps, change-journal high waters, and both live and transactional retention
floor reads reject corrupt values with `SNAPBACK_STORAGE_VERSION_CORRUPT`.
The shared query/get/admin-scan document decoder applies the same check to
managed-row `_version`, so corrupt row cursors cannot escape as negative or
lossy JSON numbers. Queries and bulk mutations preflight the table whenever
`_version` itself drives filtering, joining, or ordering, so SQL cannot hide a
corrupt row before the decoder sees it. An indexed journal-integrity sentinel
checks every row—not only `MAX(version)`—before publishing a table cursor,
validating a captured predicate, or pruning; selected journal rows are decoded
again at reconstruction and must prove the exact operation, snapshot shape,
row id, and row version used by predicate validation. Retained mutation replay
decodes both the output version and SQL settlement version and refuses malformed
or mismatched metadata (while preserving the legacy zero migration sentinel).
Direct SQL readers translate REAL, TEXT, and BLOB version values into the same
typed corruption diagnostic rather than leaking adapter errors. Pruning and
membership expiry planning also reject non-portable time floors before touching
journal or membership state. Live publication refuses a failed durable-version
read; receipts and host-ops publish an explicit diagnostic with a required-null
or absent artifact cursor instead of fabricating zero. The generated contract
now applies the portable maximum to captured dry-run read versions,
authorized-lease snapshot heads, and permission-epoch resync witnesses as well
as the primary mutation/live cursors; consumer regressions reject max-plus-one
in the standalone and embedded forms.

Membership declaration activation and protected-holder lifecycle checks now
preflight the complete membership and resource relations at their pinned
storage head. This applies before schema DDL or seed work and again to the
transaction-final state, so an unrelated seed, an earlier valid holder, or SQL
selection order cannot conceal a future-version row and legitimize it as
authoritative state.

The final exact portable version is still usable once; its successor is a
terminal `SNAPBACK_STORAGE_VERSION_EXHAUSTED` refusal with rows, auth version,
and journal unchanged. Generated schemas publish the same maximum.

Focused proof on 2026-07-17:

- `cargo test --lib exhaustion_ -- --nocapture` — 19 passed.
- `cargo test --lib corrupt_ -- --nocapture` — 22 passed after the structural
  journal, replay metadata, SQLite storage-class, and publication regressions.
- `cargo test --lib reopen_ -- --nocapture` — 9 passed, including refusal of a
  missing canonical head and migration of the journal sentinel only after a
  healthy preflight.
- `cargo test --lib unrelated_seed_cannot_legitimize_future_membership_activation_sources -- --nocapture` — passed.
- `cargo test --lib network_unrelated_seed_cannot_legitimize_future_activation_sources -- --nocapture` — passed.
- `cargo test --lib lifecycle_holder_check_cannot_hide_a_later_future_row_after_a_valid_holder -- --nocapture` — passed.
- `cargo test --lib membership_sweep_rejects_an_unrepresentable_time_floor` — passed.
- `cargo test --lib --no-run` — passed.
- `cargo test --lib prune_rejects_a_nonportable_time_floor_without_touching_the_journal -- --nocapture` — passed.
- `cargo test --lib` — 1,098 passed, 0 failed after the final brownfield/open
  classification regressions joined the suite.
- `cargo test --test artifact_schemas_v0 -- --nocapture` — 22 passed, including
  portable dry-run, authorized-lease, resync-epoch, and receipt schema bounds.
- `cargo check --lib` — passed.
- `./ref-check --verbose` — 63 LLP documents and 1,357 references passed
  with 0 errors and 0 unchecked references.
