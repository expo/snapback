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
Pruning rejects a non-portable time floor before touching journal data.

The final exact portable version is still usable once; its successor is a
terminal `SNAPBACK_STORAGE_VERSION_EXHAUSTED` refusal with rows, auth version,
and journal unchanged. Generated schemas publish the same maximum.

Focused proof on 2026-07-17:

- `cargo test --lib exhaustion_ -- --nocapture` — 18 passed.
- `cargo test --lib corrupt_ -- --nocapture` — 12 passed.
- `cargo test --lib prune_rejects_a_nonportable_time_floor_without_touching_the_journal -- --nocapture` — passed.
- `cargo test --lib storage_version -- --nocapture` — 4 passed.
- `cargo check --lib` — passed (two pre-existing dead-code warnings).
