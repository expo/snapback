# G7.1: depth-one synchronous Postgres group commit

Base: `77a36819f4` (R1 rebased onto `d0c0c1298f`), branch `sb4-pg/g71`.
Only G7.1 of accepted LLP 3000.009.001.000.000.002 revision 4 is implemented.
No overlapping batches, extra writer connection, asynchronous commit, publication
qualification or throughput campaign is introduced.

## Protocol

Eligible multi-member G3b attempts open with BEGIN/settings, the raising owner
fence, a store-keyed transaction advisory ticket, an unlocked head identity and
transaction id, and composed authority, receipt and level-zero facts in one
message. The ticket's upper 58 bits come from the store id; its lower six are a
per-store batch ordinal modulo 64, independent of the attempt counter.

The final data message rechecks generation/store identity and applies the vector
tail through an exact `(seq, revision, attempt)` CAS using catalog-qualified
equality for all three fields. Revision is assigned absolutely in this CAS; no relative revision update precedes it. Every count,
including image updates, is verified before the separate uncancellable COMMIT.
Publication uses the updated head's RETURNING relation. Pruning covers only the
newly expired sequence interval. An unproved dependency closure rolls back before
running the existing barrier fallback. Only buffered tail production and commit
can use the ticket order; authority and other family mutations retain the head
lock requirement.

`_head.attempt` is a C-collated text encoding of `(owner token, counter)`. The
process-wide atomic counter is shared across handles, increases for every writer
attempt, survives rollback/retry/reconnect in memory, and only raises its floor
when attach reads a persisted attempt. Production ownership reacquisition raises
the token. Fenced attach adds/validates the column. Read-only recovery bootstrap
accepts the complete pre-upgrade head and validates the new shape when present.
Barriers retain their old lock protocol and write fresh attempts. SQLite retains its previous routing, protocol and budgets. Depth one retains existing provisional-state rollback and release behavior,
including the synchronous G6 COMMIT guard.

## Flight budgets

| Warm batch class | Before R1 | R1 / lane base | G7.1 |
| --- | ---: | ---: | ---: |
| Eligible, level zero, G5 | 5 | 4 | 3 |
| Eligible, level zero, G6 | 6 | 4 | 3 |
| Eligible, one additional dependency level, G5/G6 | 6 / 7 | 5 | 4 |
| Idle N=1, barriers, ineligible work, SQLite | Existing route | Existing route | Unchanged |

These are batch flights, independent of N (N=8/32 core; N=4/8/32 HTTP).
Core solo counts remain 6 (independent) and 9 (shared) under G5 and G6.
SQLite core counts at N=1/8/32 remain 21/87/327 (independent) and 24/59/203
(shared); its HTTP snapshots are unchanged. Cold statement preparation is
separately charged by RT0. No throughput gain is claimed from a flight count.

## Witnesses and failing-before evidence

On unchanged `77a36819f4` with only new tests/ratchet assertions present:
five Postgres protocol witnesses fail and the SQLite randomized differential
passes. ABA, fault/nonce and random-boundary PG witnesses encounter the absent
attempt column; the two-store witness finds no advisory ticket; the concurrent
barrier cannot acquire the opener's head lock. The new core RT0 assertion fails
at four flights versus the required three. These are runtime failures, after a
successful build. A strengthened ABA witness additionally fails with a
schema-local text equality operator that treats nonce pairs as equal; qualifying
the CAS comparisons with `OPERATOR(pg_catalog.=)` makes it pass. Raw logs remain
outside Git on the lane host.

The ten G7.1 tests cover:

- A stale attempt with unchanged numeric head, including operator shadowing,
  refuses and reruns.
- Attempts never repeat across undispatched abort, P1 abort, tail abort,
  confirmed commit and reattach; `pg_xact_status` agrees with known outcomes.
- Two stores hold independent store-keyed tickets in one database.
- A concurrent real barrier holds the head; the batch final waits, then its CAS
  refuses without a deadlock.
- Generation drift after P1 rolls the whole tail back; its xid is aborted.
- Random boundaries against N=1 on SQLite and Postgres: three seeds, 192 members
  each, hot keys, keyed duplicates across batches and explicit barriers. Compared
  outcomes include meters; complete snapshots include rows, receipts, sequences,
  evidence, log images, outbox and head. PG also compares seq/revision and fresh
  attempt identities.
- Faults before/after facts, tail and COMMIT preserve the known-abort/unknown
  table and contiguous head.
- Read-only recovery accepts the complete legacy bootstrap; fenced attach
  upgrades a missing column and refuses an incompatible one atomically.
- A refused owner fence writes nothing.

Separate G6 RT0 checks verify publication equals the committed head and revision,
as well as the flight budget.
Existing G3b witnesses additionally cover keyed duplicates, authority, effects,
intermediate log images, late unknown families, suppressed images and all member
boundaries. Attempt identities are deliberately fresh, so the paired oracle
compares their uniqueness/order rather than demanding equal private nonces.

## Verification and custody

| Check | Passed | Failed | Ignored |
| --- | ---: | ---: | ---: |
| Complete core (49 direct Cargo targets, including doctests) | 1,275 | 0 | 449 |
| Full binary | 608 | 0 | 57 |
| Affected program-batch suite | 85 | 0 | 0 |
| G7.1 witnesses | 10 | 0 | 0 |
| Core RT0 (G5, G6, SQLite) | 3 | 0 | 0 |
| Real-owner G6 publication/three-flight witness | 1 | 0 | 0 |
| HTTP RT0, both stores and G6 | 9 | 0 | 0 |
| TCP/pipeline | 9 | 0 | 0 |
| Complete Postgres script (36 direct Rust target runs) | 816 | 1 | 0 |

The sole final Postgres failure is the author-declared inherited evaluator stress
case `evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`:
SQLSTATE `40001`, concurrent-update serialization failure at the unchanged
`experiments/postgres/tests/conformance.rs:294`. It remains enabled and is not
retried to obtain a green result. Every other final Rust case passes, and the
public Postgres serving milestone passes, including both stores' evolution,
wire/meter parity, retained/pruned evidence, restart, ownership and S1 fixture
recount checks.

`./ref-check`: 569 LLP documents, 11,970 references, zero errors and zero unchecked
references. `git diff --check` passes. Counts above exclude nested test subprocess
summaries to avoid double-counting.

The first Postgres script records 814 passed / 3 failed: two TCP-required cases
refuse socket-only input, and R1's G6 publication assertion still expects four
flights. The final script supplies explicit loopback TCP input on a fresh private
PG16 cluster and updates that assertion to three; all three corrected cases pass.
The final run retains only the inherited `40001` above.

Both private lane clusters and both public-witness clusters are stopped and
independently checked: postmasters `2045954`, `2233661`, `2224647`, `2281431`;
each has `pg_ctl status=3` and no `postmaster.pid`. The two public PID ledgers
contain 1,070 records; the combined audit checks 1,077 unique recorded PIDs,
including cluster roots/children, with none remaining. **PIDs left: none.**
Raw logs and stopped test data remain outside Git (`/tmp/sb4-g71-*.log` and the
owned cluster directories); no raw logs are committed.

PG16.15 uses `fsync=on`, `synchronous_commit=on`, `full_page_writes=on`. Builds use
the lane's own target directory, `-j 6`, and line-tables-only dev/test debug info.
Only loopback correctness and relative plan witnesses run. Sampled one-minute
host load averages range roughly 1.1–16.4; the host is shared. Disk checks remain
above the 40 GiB floor; final available space is 79.67 GiB. No push, Git
configuration change, or publication occurs.

The first binary test invocation ran without the built CLI helper expected by
process-supervisor/worker tests (580 passed, 28 failed). After building the
ordinary `snapback4` executable, the complete rerun passed 608/0/57. No test or
product change was needed for those setup failures.

Failing-before raw-log SHA-256 (outside Git):

- Parent protocol witnesses: `96da3e8ca02d57f0b93cbbab86e49db3ac27edfdd255b80fb29cd8812ca7fda5`.
- Parent core RT0: `165035655262ff63aa0249959a6444baa0a0e17bae2cf13972cdbbef5bd6619f`.

- Operator-shadowing ABA before hardening: `5606632d408c08f2e3ce08a2f30c278da4d8357952018b08363b22693c5f1c8a`.
