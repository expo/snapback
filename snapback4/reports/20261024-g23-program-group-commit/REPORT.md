# G2/G3: program outcomes and serial group commit

Lane `sb4-pg/g23`, RT6 base `2fdab64882`, warm target on expo-build-450a.
Work began 2026-10-23; qualification and measurements are recorded on 2026-10-24 (Europe/Berlin).
The accepted controls RFC was absent at this base and imported from
`fcc2aa96ad`; its G2/G3 notes and the committer §3.4 amendment accompany code.
This report records a local durability diagnostic, **not a scale claim**.

## Outcome protocol and transaction shape

Each admitted owned program invocation has a private, incarnation/intent-bound
in-memory identity and a cached terminal outcome. Duplicate internal delivery
returns that outcome. A new unkeyed HTTP request remains a new invocation:
no public `id` is added, and no durable internal `_ops` receipt is created.
Existing client-keyed receipts remain bound and replayable after takeover.

Only acknowledged physical rollback or explicit database COMMIT-abort evidence
permits recovery. A named database-member failure removes that member and
retries survivors in original order; successive named removals are bounded by
N and remaining deadlines. An unnamed confirmed abort gets one solo attempt
per member, in order. The original admission deadline bounds fallback
execution through PG statement/lock timeouts or SQLite progress and busy
callbacks, including BEGIN and page-cache spill. SQLite restores the host
contention policy before the uncancellable COMMIT.
Attempts rebuild meter/context/effects and resample authority, effective time
and presence while retaining minted ids. A failed rollback or ambiguous
COMMIT produces `E_COMMIT_OUTCOME_UNKNOWN` for the entire batch, including
tentative refusals, and never reruns. It carries no success/head metadata.

The worker drains already-queued contiguous program commands, at most 32,
with a 1 ms collection cap and immediate execution when the queue empties.
It starts at N=32 and adjusts against rolling queue-through-COMMIT p99 and
the 100 ms write SLO. Nonprogram, native/long, administrative and ephemeral
work stays solo; timed-publication schemas conservatively stay solo too.
Every producer keeps its revision/evidence seam.

One fenced transaction executes members serially through their existing
member/program savepoints. Normal application/authority refusals remain local
when member rollback is acknowledged. Later programs see predecessors' rows,
logical head and buffered keyed receipts. PG sends one verified vector-tail
CTE for commits, logs, change evidence, effects/presence and receipts, with
one head update; every family count is checked before the separate,
uncancellable COMMIT flight. SQLite retains the serial recorder within one
IMMEDIATE transaction and one physical COMMIT. Entropy/publication data and
host continuations cross durability and run in member order.

## Witness coverage

The randomized serial-history oracle uses three seeds, 192 invocations per
seed and N=4/16/32 versus N=1 on **each store**. It compares full outcomes and
meters, maintained rows, parent-prefixed sequences, raw receipt fields
(including sequence/time), effects, every intermediate commit/log image and
change-evidence footprint. Commit sequences must be contiguous through head.
It also compares duplicate keyed members, replay and a rebound client id.

Fault witnesses cover every position in eight-member batches at before-member, member
savepoint, program savepoint/release, member release and after-member, plus
before/after tail and before COMMIT. Real PG triggers fail each member and
suppress each tail family/head write to verify count rejection. Additional
witnesses cover failed rollback, known deferred COMMIT abort, lost COMMIT
acknowledgement, unknown batches including tentative refusals, expired retry
budgets, real SQLite BEGIN/page-spill lock barriers with ordinary-wait negative
controls and policy/progress restoration, fresh time/presence on rerun, queued
revocation/expiry and duplicate
internal unkeyed delivery. Real owned-queue barriers show no continuation or
visibility before durability, kill the writer during COMMIT and retry keyed
intent under a new fenced owner. Existing ownership and serial oracles remain
in the qualification.

The final qualification results and measurement aggregates follow below.

## RT0 classes

Every existing N=1 class keeps its expectation. The batch classes are controlled
live-credential core calls excluding HTTP ingress; PG counts are flights and
SQLite counts are statements. N=1 HTTP and grouped core totals have different
boundaries and remain separate classes.

| Class | PG | SQLite |
| --- | ---: | ---: |
| HTTP unkeyed increment, N=1 | 8 | 22 |
| HTTP keyed first, N=1 | 9 | 30 |
| HTTP replay hit, N=1 | 2 | 5 |
| Controlled core batch, N=4 total | 20 | 66 |
| Controlled core batch, N=32 total | 132 | 486 |
| Controlled core batch, N=4 per member | 5 | 16.5 |
| Controlled core batch, N=32 per member | 4.125 | 15.1875 |

The HTTP ratchet also asserts that unkeyed replies have no `id` field.

## Private PG16 loopback diagnostic

The actual S1 `increment` Quarry body runs through the owned core committer with live account credentials and a fenced lease, 32 concurrent closed-loop writers, 32 owned counters and one room. HTTP, ingress, response encoding, network delay injection and the 1M-message scale seed are excluded. No server-side evaluator retry or overlay is used. Each trial has 1 s warmup and 3 s timed work, including final drain in elapsed time. Fixed targets run in order `1,4,16,32,32,16,4,1,1,4,16,32`; three trials per N. The table gives medians and rate ranges, not confidence intervals or a scale claim.

PG version: 16.15 (160015). Durability settings: `{"fsync": "on", "full_page_writes": "on", "max_connections": "200", "synchronous_commit": "on"}`. Loopback TCP port 55473; lease renewal is independent of the writer queue at 700 ms. The Rust test profile uses opt-level=1 with line-table debug info; Cargo uses five jobs. Measurements run after this lane's heavy checks finish. Host load is recorded immediately before and after each timed phase.

| Max N | Writes/s median (range) | Total service µs/write, median | Physical COMMIT µs/member, median | Request p50 / p99 ms, medians |
| --- | ---: | ---: | ---: | ---: |
| 1 | 233.4 (219.4–236.6) | 4283.7 | 2763.3 | 137.52 / 182.74 |
| 4 | 527.6 (525.5–549.3) | 1895.4 | 694.4 | 59.02 / 72.27 |
| 16 | 884.3 (865.2–885.3) | 1130.8 | 173.3 | 37.40 / 50.37 |
| 32 | 979.6 (942.5–1061.2) | 1020.8 | 86.4 | 33.90 / 58.40 |

Physical COMMIT time is measured on the writer thread around the separate uncancellable commit operation, summed and divided by successful members. Total service time is elapsed time divided by writes and includes the full transaction/body cycle and drain. These are different quantities; COMMIT time alone is not the per-write bottleneck model. Every trial checks exact durable counter totals, successful replies, histogram/member/physical-commit agreement and that its two recorded owned backends disappear when the queue drops.

| Max N | Batches, all 3 trials | Mean actual fill | Actual fill → batch count (percentage) |
| --- | ---: | ---: | --- |
| 1 | 2163 | 1.00 | 1→2163 (100.0%) |
| 4 | 1225 | 4.00 | 1→1 (0.1%), 3→1 (0.1%), 4→1223 (99.8%) |
| 16 | 500 | 15.94 | 4→1 (0.2%), 5→1 (0.2%), 7→1 (0.2%), 16→497 (99.4%) |
| 32 | 286 | 31.45 | 1→1 (0.3%), 4→2 (0.7%), 23→1 (0.3%), 26→2 (0.7%), 27→3 (1.0%), 28→5 (1.7%), 29→1 (0.3%), 30→1 (0.3%), 31→8 (2.8%), 32→262 (91.6%) |

The collection policy drains only work already queued; these fill distributions are part of the result. A target N does not promise a full batch or a latency-SLO pass.

Timed-phase window: 2026-10-23T23:43:17+00:00 through 2026-10-23T23:44:17+00:00. Recorded one-minute host load spans **1.53–1.75**; available CPU affinity reports **12** CPUs. This is a shared host, so rate differences are diagnostic and include that variation. Raw JSON, per-request latency samples and process logs remain outside Git.


## Qualification and retained failures

| Check | Result |
| --- | --- |
| CLI `cargo build --locked -j5 -p snapback4` | Pass, final normal build |
| Full core `--features postgres --no-fail-fast` | Pass: 730 unit passes, 279 named ignores; every unignored integration/doc target passes, including all 38 doc tests |
| Full binary `--features postgres --bin snapback4` | Pass: 577 passes, 45 named ignores |
| Final program/identity/transcript/batch scope, both stores | 19/19 pass after the SQLite deadline follow-up |
| Final outcome/deadline scope | 6/6 pass, including real SQLite contention and PG's one remaining statement budget |
| PG adapter / ownership / evolution | 232/232, 25/25, 60/60 pass |
| Command queue, including owned batch kill/takeover and durability barriers | 15/15 pass |
| RT5/RT6 codec and serving-flight scope | Corrected final scope 19/19 pass |
| Both RT0 ratchets | Pass; final selector has five passing tests, no N=1 allowance change |
| Selected authority-boundary HTTP scope | 62/62 pass |
| Five-executor corpus overlap | 22/22 pass |
| Differential library / store campaigns | 11/11 and 4/4 pass |
| Public CLI deploy/serve | Pass: P1-EV-1/2 byte-and-meter parity, restore, changes, restart, SIGKILL takeover, session/logout, non-superuser serving and unchanged S1 Quarry P1-MC |
| Controlled private loopback sweep | 12/12 trials pass, exact durable totals and backend cleanup |
| Auxiliary check / committer census / web-helper target | 106/106, 3/3 and 1/1 pass |
| Store-port census | Inherited five production references in `engine/evaluation.rs`; no new site or allowance raise |
| Root `./ref-check` | Pass: 567 LLP docs, 11,838 refs, zero errors/unchecked |

The full core run completed before the final SQLite lock-budget follow-up.
That follow-up was qualified with the complete six-test outcome scope and
nineteen-test program/batch scope; the full binary, RT0 and normal build use
the follow-up. No expensive unaffected full-suite repeat is claimed.

The complete `bash scripts/test-postgres.sh` runs every stage and exits **1**.
It retains the evaluator Serializable `40001` stress failure already recorded
in [RT6](../20261023-rt6-serving-flights/REPORT.md) and the
[existing ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
It also exposed an affected RT6 fixture that expected one tail count; the
verified tail now returns five. The corrected fixture asserts all five Bind
and literal counts and the full durable-state census; its final nineteen-test
scope passes. All other stock script stages pass. This is not a clean
full-script claim, and no stress exclusion, timeout or durability setting is
changed.

An additional full CLI **package integration** sweep retains four known
`E_SCHEMA: source reservations differ from the schema derivation` cases in
`init` and `timeline_adoption`, plus the previously observed time-sensitive
`security_wave19::check_refutes_excluded_contact_roles_before_any_full_test`
(check exits zero with two unproved invariants). These are distinct from the
passing full binary unit target. Their patterns are documented in the
[RT3b baseline](../20261023-rt3b/REPORT.md),
[RT12 baseline](../20261023-rt12/REPORT.md) and
[publication report](../20261022-publication-0.4.38/REPORT.md).
The package sweep's initial TypeScript-prerequisite and missing generated JS
helper failures are resolved by the local prerequisite install/generation;
the complete `check` target and `witness_web` target subsequently pass.
No JS/wasm package-build qualification is claimed.

The remaining store-port census hit is byte-identical to RT6 `2fdab64882`.
It is filed in the [filesystem ticket](../../../issues/20261024-snapback4-evaluator-store-port-census.md).
The new member driver and queue add no remaining production census site.

## Custody and cleanup

Qualification PG16 postmaster **4027594** stopped with independently checked
status 3, absent process/pidfile/socket and closed loopback listener. The public
CLI witness's PG16 postmaster **686738** stopped with status 3 and no pidfile;
all **550** recorded public-witness PIDs are independently absent. Measurement
used fresh PG16 postmaster **955188**, also stopped with status 3, no pidfile,
no socket and no TCP listener. The final census combines all three masters,
public children, 24 measured owned backends and the recorded measurement
background workers: **581 unique PIDs checked, none alive**.

PG17/55440, `~/q24`, Git configuration and stashes are untouched. No push was
made. All disk checks stayed above the 40 GB stop rule; the final `df -h /home`
shows 80 G free. Raw logs, raw measurement JSON and PG data remain outside Git.
Only this aggregate report, the repeatable ignored measurement test and the
repository-scoped census ticket are committed with final metrology.

## G2/G3 fix round 1 — 2026-10-24

This round starts from `b3c4aa2bbaca2015ffc0cbb8eb94a9c2b481b163`
on `sb4-pg/g23-fix1` in `~/projects/sb4-s10a`. It addresses the supplied
Sol CHANGES REQUIRED and Grok APPROVE WITH NITS reviews. It adds no
performance measurement or scale claim. Cargo uses this worktree's own
`snapback4/target`, four build jobs, and `line-tables-only` dev/test debug
information. Database witnesses use private socket-only PG **16.15**.

The failing-before runs used the base production paths with the new tests
and a `cfg(test)` post-tail hook. The hook pauses only after successful
adapter tail preparation; it models response delivery or worker scheduling
crossing a deadline without making SQL itself time out. The eight defect
witnesses below failed before the production fixes. Raw output remains in
`/tmp/sb4-g23f1-before-batch.log` and
`/tmp/sb4-g23f1-before-solo-direct.log`; no raw log is committed.

| Finding | Failing-before observation | Correction and witness |
| --- | --- | --- |
| Physical uncertainty versus retained authority refusal | `authority_refusal_cannot_hide_unknown_physical_rollback` returns `[E_AUTH,E_AUTH]` both initially and after named removal. The N=1 authority witness also returns `E_AUTH`. Each kills its recorded backend through a separate connection while refusing authority. | A retained refusal is selected only with confirmed physical abort evidence; the N=1 wrapper also preserves unknown. A writes provisionally before B refuses and loses rollback acknowledgement. Both remaining members must receive and retain `E_COMMIT_OUTCOME_UNKNOWN`; attempts prove no rerun. |
| Member deadlines | `named_fallback_statements_use_each_members_own_deadline` rejects B with `E_STORE` after inheriting A's 500 ms budget, although B has 5 s for its 700 ms statement. | The opener uses the first member's deadline, each member replaces the statement/lock deadline, and shared tail work uses the earliest survivor. Expired A refuses while B commits within its own budget. |
| Tail-to-COMMIT gap | `batch_deadline_after_verified_tail_{sqlite,postgres}` commits A/B after the pause. `solo_deadline_after_verified_tail_{sqlite,postgres}` also succeeds after crossing the original deadline on its known-abort retry. | Both retry drivers recheck after verified tail preparation and before uncancellable COMMIT. Four witnesses require failure and unchanged durable state; N=1 includes an actual commit/evidence tail and a deferred-constraint first-attempt abort. |
| Deferred predecessor metadata | `deferred_internal_tail_readers_are_ineligible` admits a mutation with a nested `_commits` read in an untaken branch. | Exhaustive IR effects exclude internal commit/log/evidence/outbox/presence/receipt readers and writers from grouping. The witness covers all five deferred families. Ordinary predecessor rows, logical head and buffered keyed receipts retain their existing visibility. |

The oracle now has restrictive insert and named update rules, capped source
rows and a separate capped, expiring `slots` table. Keeping expiry separate
preserves the maintained-column source contract while exercising physical
cap occupancy. The snapshot adds complete `_commits` fields, cap occupancy
and `_effect_presence` (principal, id, deadline and reconnect flag). The
oracle requires actual rule and cap refusals and nonempty occupancy/presence;
it compares all three seeds at N=1 versus N=4/16/32 on each store. Both pass.

The trigger witness includes `_effect_presence` and verifies the exact
vector count-mismatch column and acknowledged physical rollback for all
seven families, then exercises the fallback driver and checks unchanged
state. This final seven-family scope passes. These coverage additions do
not claim an additional base production bug. Early fixture-only reds
(nonexpiring caps have no physical occupancy table; maintained columns
cannot use an expiring source) were corrected before final qualification.

Fix-round checks (same product delta, this worktree's target):

| Check | Result |
| --- | --- |
| Default CLI build | Pass. The initial no-Postgres build exposed an ambiguous SQLite `Ok(())` in preparation; the explicit result type fixes it and the final ordinary build passes. |
| Full core, `--features postgres --no-fail-fast` | Pass: 735 unit passes, 284 named ignores, every unignored integration target and all 38 doc tests. |
| Full `snapback4` binary, `--features postgres --bin snapback4` | Pass: 577 passes, 45 named ignores. |
| Both RT0 ratchets | Pass: five selected tests; N=1 expectations unchanged, warm PG batches 20/132 flights and SQLite 66/486 statements at N=4/32. No allowance edited. |
| Final program/batch matrix | 23/23 pass in the stock Postgres script, including both stores' three-seed oracles, all boundaries, all seven tail triggers, initial/named/solo unknown-authority witnesses and independent deferred-family eligibility checks. |
| Final outcome/deadline matrix | 8/8 pass, including four post-tail cutoffs and the original contention/budget controls. |
| Product PG adapter / evidence / codec / ownership / evolution | 232/232, 13/13, 19/19, 25/25 and 60/60 pass. |
| Committer / maintained member / command queue | 3/3, 1/1 and 15/15 pass. |
| Selected HTTP authority boundary | 62/62 pass; other selected host and publication scopes also pass. |
| Five-executor corpus overlap | 22/22 pass. |

The full core run preceded two final **test-only** strengthenings: checking
each metadata family from a fresh program copy and adding an insert rule
that reads the changing parent counter (`.counter.n != -1`). The independent
eligibility rerun passes, and the final 23-test matrix reruns both stores'
complete strengthened histories and tail-count scope. Product source did
not change after the full core/binary/RT0 qualification. The final schema
also passes the ordinary CLI `check`.

The differential library and store campaigns pass **11/11** and **4/4**.
The ordinary CLI rebuild passes, and the complete public deploy/serve witness
passes evolution/restore byte-and-meter parity on both stores, 1,000-entry
change-evidence retention, bootstrap recovery, startup lease release, receipt
replay, restart, SIGKILL takeover, logout/ownership loss and the unchanged S1
Quarry maintained-total fixture.

The complete `bash scripts/test-postgres.sh` runs every stage and exits **1**
solely for the inherited
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
Serializable **40001** failure (`tests/conformance.rs:294`). This is the same
failure recorded above and in the existing
[ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md).
Every other stage passes; no stress exclusion, timeout or durability setting
was changed. This round makes no clean full-script claim. The first default
build's result-type error was corrected and its successful final rebuild is
recorded above.

Primary postmaster **1268235** and public-witness postmaster **1613023** are
stopped. Both independent `pg_ctl status` calls return 3; neither cluster has
a pidfile, socket or socket lock. The final audit finds **all 571 unique
recorded owned PIDs absent**, including 546 public launch records, primary
background workers, fault backends and snapshot workers. **PIDs left: none.**
Final `/home` free space is **74 G**; every sampled reading stayed above the
40 GB stop threshold. Raw logs, PID manifests and private PG data remain in
`/tmp`, outside Git. No push, stash or Git configuration change occurs.

Final `./ref-check` passes: **567 LLP docs, 11,840 refs, zero errors and zero
unchecked references**. The final diff whitespace check is clean.
