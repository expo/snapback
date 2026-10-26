# WF — synchronous final flights, CPU and ordered reply release

Default S now commits eligible buffered batches in **two flights**. E stays
opt-in with its three-flight certificate protocol. Input is `5fc6e6449b` on
`sb4-pg/wf`, in `/home/ccheever/projects/sb4-rt12f2`, on the commissioned
expo-build-450a builder (kernel hostname `expose-builder-nothing`). Nothing
was pushed or published. These are loopback checks; the
[S1 attribution](../../experiments/scale-controls/results-20261026-s1-write-attribution/README.md)
remains the campaign record, and the authoritative rerun belongs elsewhere.

The final message keeps the predecessor ticket, fresh generation/store check,
exact head CAS, apply and tail as ordered statements. Session-local functions
raise on identity drift and every count: head, commits, evidence, log,
effects, effect presence, receipts and images. Client-only deferred row checks
retain the separate COMMIT path. Explicit synchronous certificate settings
zero statement/lock timeouts and PG17 transaction timeout before COMMIT.
Dispatch starts the wider unknown window. After dispatch, only an explicit abort response
plus the original transaction's acknowledged end permits recovery; a later
ROLLBACK cannot undo or classify a possibly committed final. Complete tags
and the driver's final ReadyForQuery are required for success. The parent
round-trip §3.5/§7 and store-port §5.2 amendments land with this change.

| Mechanism | Evidence |
| --- | --- |
| Raising decisions before COMMIT | All eight suppression cases end with aborted xids and no retained tail. Wire observes eight `S4003` + ReadyForQuery `E` outcomes without COMMIT. Generation and store drift add two aborted identities. |
| Ticket timeout and uncancellable final COMMIT | Ticket timeout produces an aborted xid and ReadyForQuery `E`, skipping COMMIT. A 150 ms deferred COMMIT survives a 60 ms statement budget; on PG17 it also survives an 80 ms session transaction timeout, which is restored afterward. |
| Wider unknown window | Wire cuts before forwarding, after a result row and after COMMIT each return unknown to all eight members, with one original xid and no rerun. Terminating an owned backend inside held deferred COMMIT also stays unknown. Transaction status and contiguous-history checks cover the outcomes. |
| Semantic preservation and provisional state | All G7 tests pass 88/0, including held folds, randomized N=1 equivalence, cascades, drainage, nonce reuse prevention, ownership, visibility and G6 closure. E core/HTTP pass 40/0 and 5/0; crash/kill passes 11/0 with zero acknowledged loss or lost-history reader release. |
| Preparation and callback CPU | Finished image maps and member contexts move into their next owner. Each distinct program's static debug proof is checked once per immutable wave; argument, authority and dependency checks remain per member. Each indexed outcome moves into its sole callback. The retained-plan/per-member-argument witnesses pass on SQLite and Postgres. |
| PG-tail CPU | One materialized JSONB value supplies all recordsets. The logical writes, intermediate commits, counts and pruning interval are unchanged. Numeric ExecutorRun thread clocks measure the actual vector tail. |
| Prompt ordered release | A version/condition notification wakes the sole committer without consuming mailbox capacity or retaining a sender cycle. It drains ready prefixes in revision order; a third wave waits for oldest-slot capacity. A single held asynchronous slot records **0 idle polls in 20 ms**. The test-only old timer records **127** and fails the same witness. |

Negative controls are retained outside Git. Without raising counts, a
suppressed-head xid is **committed**, failing the required aborted status.
Restoring separate COMMIT fails the two-slot ratchet **6 versus 4**. The
faithful one-slot legacy timer fails as described above; an earlier polling
stress variant also records 130 polls. The first idle fixture did not prove
asynchronous dispatch and was replaced by a warmed W4 fixture with an
explicit dispatched-slot assertion. Early build/proxy setup attempts and
measurements overlapping the full checks remain outside the final comparison.

| Warm class | Before | After |
| --- | ---: | ---: |
| S level-zero eligible batch, N=1 successor / 8 / 32, G5 or G6 | 3 | 2 |
| S batch with one dependent facts level | 4 | 3 |
| E eligible batch, marker in its final message | 3 | 3 |
| HTTP idle unkeyed increment fixture | 6 | 6 |

The final paired sanity used one private PG16 cluster after the owned checks
stopped: 32 closed-loop clients, 256 warm-up and 1,280 measured writes per
cohort, two repetitions, depths 1/2, W4/W5-exact/W5 1% mix. Probe order was
before/after and native order after/before. All **48 cohort counter checks**
pass. The before binary restores the old mechanisms on the same base with
the common buffered clock observer; it is not presented as an exact original
source build. Both binaries use test opt-level 1, line-tables-only and the
same evaluation features, with fsync, full-page writes and synchronous commit
on. This compact Quarry fixture has no HTTP or injected A/B RTT and is not
the one-million-message campaign. No capacity search or rung qualification
is claimed. Load, batch histograms and all cohort aggregates are in
[measurements.json](./measurements.json).

| Native measured residence, 32 clients | Before ms | After ms |
| --- | ---: | ---: |
| W4 | 9.638 | 8.349 |
| W5 1% mix | 10.005 | 8.305 |
| W5 exact, diagnostic control | 12.704 | 10.611 |

W4 and mix have mean N=16 on both sides. Exact's native mean N changes
21.33→16, so its latency delta is not a matched-N attribution.
The following request-weighted stage clocks include warm-up; native residence
above excludes it. Slot clocks cover the asynchronous path. The stage means
are diagnostic, **not an additive native-residence ledger**.

| Stage, before / after ms | W4 | W5 1% mix |
| --- | ---: | ---: |
| Mailbox age | 0.453 / 0.383 | 0.456 / 0.195 |
| Collection | 0.012 / 0.008 | 0.017 / 0.018 |
| Preparation to final dispatch | 4.025 / 4.169 | 4.159 / 3.871 |
| Final dispatch to confirmation | 6.210 / 5.750 | 5.745 / 5.043 |
| Confirmation to committer receipt (subset of release) | 0.148 / 0.059 | 0.151 / 0.108 |
| Confirmation to each reply | 0.284 / 0.178 | 0.298 / 0.238 |

| Thread CPU, µs per member | W4 | W5 1% mix |
| --- | ---: | ---: |
| Preparation CPU | 92.88 → 85.47 (−8.0%) | 88.04 → 79.24 (−10.0%) |
| Finishing/callback CPU | 10.40 → 7.95 (−23.6%) | 10.16 → 8.27 (−18.6%) |

PG-tail executor CPU across the probe matrix falls **1.378→0.526 ms
per vector execution (−61.8%)**; the native matrix independently
records 1.278→0.523 ms.
These PG aggregates include both depths and their batch distributions.
The numeric-only [probe source](./pg_cpu_probe.c) is an optional PG16 session
preload library, compiled against matching server headers with
`cc -shared -fPIC -O2`. It records wall/thread CPU only, never SQL or row data.
`gprofng collect app -F on` identified allocation/string copying and static
admission costs; raw experiments stay in `/tmp/wf-profile-*/cpu.er`.
Preparation CPU is reduced here by 8–10%, **not halved**. Notifications remove
the idle timer; ongoing preparation can still delay release. Exact W5's
confirmation-to-receipt clock increases 0.405→0.656 ms in this diagnostic.
The combined 13.3 ms B forecast is therefore not a qualified result of this lane.

| Check | Passed | Failed | Notes |
| --- | ---: | ---: | --- |
| Full core | 1,311 | 0 | 49 targets; 531 ignored |
| Full binary tests / binary build | 626 | 0 | 75 ignored; build passes |
| All G7 / E core | 88 / 40 | 0 / 0 | Suites overlap; 40 inherited G7.2 entries included |
| E HTTP / HTTP levers | 5 / 87 | 0 / 0 | |
| Core plan/argument levers | 2 | 0 | Within core/Postgres runs |
| RT0 core / HTTP | 6 / 10 | 0 / 0 | Both stores and S/E classes |
| PG17 E / G7.3 | 2 / 5 | 0 / 0 | Private PG17 only |
| Wire G7.3 / lost-result cuts | 5 / 3 | 0 / 0 | Cut cases each execute an eight-member batch |
| Crash/kill | 11 | 0 | Zero acknowledged loss; lost-history reader withheld |
| Full Postgres script, initial | 817 | 2 | 26 Rust targets; details below |
| Corrected G6 publication ratchet | 1 | 0 | Returned identity/head/revision all verified |
| Added single-slot notification witness | 1 | 0 | Legacy timer intentionally fails 0/1 |
| SQLite-only feature check | — | 0 | Pass |
| `./ref-check --verbose` | — | 0 | 569 LLPs, 12,047 references, 0 unchecked |

The script's additional failure was the old G6 assertion expecting three
flights when it correctly observed two. The corrected witness passes;
no unresolved introduced red remains. The inherited differential test
`both_stores_all_public_boundaries_and_write_observations` still reports
**`E_INPUT: 6`**. The inherited evaluator lockfile refuses `--locked`, so
its known **`40001`** stage does not execute. Public Postgres serving passes.
The complete battery's product implementation is unchanged by the final
edits: those only correct that test budget and add the test-only single-slot
negative control. Those changed/added witnesses were run separately rather
than repeating unrelated expensive tests. Full-battery source fingerprint:
`1bde246c0f7b2f748f5d37cf1a53e4791149bc25001b1e0a4b1f4c6cb05c5c18`; final source fingerprint:
`95cdeeb860ec5f885404d413c5058b264d48d3eb642b8640acca8fee7c4c6a55`. Suite records are in [checks.json](./checks.json).

All **30 private cluster directories** independently report
`pg_ctl status` 3 and no postmaster.pid. The combined audit checks
**11,619 PID/birth pairs**, including zombies, stopped drivers and target
executables, with two empty inspections. **PIDs left: none.** Minimum sampled
free disk is **38.66 GiB**, above the 25 GiB stop floor. Private ports exclude
55440; `~/q24` and the protected cluster were not accessed. Ownership evidence
is in [cleanup.json](./cleanup.json). Raw logs, traces, binary snapshots and
setup attempts remain outside Git under `/tmp/wf-*`; only source and curated
aggregates are committed.


## WF fix round 1 — cumulative deadline before COMMIT

Parent: `55c44e465d9f150c74ca554e29eb436946b23170`, branch `sb4-pg/wf`.
The review identified a gap in the two-flight S final: clearing the client
deadline at dispatch left the ticket and tail with independent statement
limits. Their combined duration could exceed the invocation budget and
still reach COMMIT.

After encoding the final commands, the client now computes remaining
microseconds from the original monotonic deadline. In that same message,
after the tail and before certificate settings, `pg_temp.sb4_assert_deadline`
compares this duration with server elapsed time since receipt of the whole
simple-query message (`clock_timestamp() - statement_timestamp()`). Both
timestamps are on the server, so client/server clock skew does not affect
the comparison. Expiry raises `S4006` and skips COMMIT. An acknowledged
ROLLBACK proves a known abort with no named failed member: G2/G3 recovery
refuses expired members and gives a live peer its existing fresh-fact
fallback within its original deadline. It does not use the ticket-timeout
class that prevents all peer reruns. The certificate still zeros statement,
lock and PG17 transaction timeouts before entering uncancellable COMMIT.

| Deterministic witness | Ticket wait ms | Tail ms | Budget ms | Original xid | Passed / failed |
| --- | ---: | ---: | ---: | --- | ---: |
| New witness on unchanged `55c44e465d` product code | 604.774 | 600.975 | 1,000 | committed | 0 / 1 |
| Fixed focused run | 605.243 | 601.440 | 1,000 | aborted | 1 / 0 |

The witness rendezvous waits until the worker is actually blocked on its
predecessor ticket before holding it another 600 ms. A trigger spends
another 600 ms in the tail. Nontransactional sequence counters verify both
individual durations remain below the statement limit, the combined budget
is exceeded, and the deferred COMMIT trigger is never entered. The fixed
run also checks no receipt, effect or head advance remains, known-abort
classification permits recovery, the expired member never reruns, and the
live member gets exactly one successful fresh attempt.

The wire observer requires one `S4006` + ReadyForQuery `E` result without
COMMIT, eight count-assertion aborts, one ticket timeout and two identity
aborts. It also confirms successful idle COMMIT ends. Its first run exposed
an observer race: a queued ROLLBACK replaced the preceding request's error
before ReadyForQuery was recorded, counting only seven of eight count
aborts despite all seven Rust tests passing. The observer now pairs replies
with startup/simple-query/extended-Sync requests in FIFO order. The repaired
normal run and all three wire cuts pass; cuts before forwarding, after a
row and after COMMIT retain unknown outcomes without automatic rerun.

All 90 G7 cases pass, including the two-slot S ratchet for N=1/8/32 with
G5/G6: successful eligible S batches remain **2 flights**, with no new
flight for this guard. E core passes 40/0. Private PG17 passes both
certificate-timeout cases and all seven G7.3 cases; the slow deferred
COMMIT still outlives the statement and session transaction budgets.

The review's low-priority non-allowlisted SQLSTATE observation remains
conservatively unknown. Widening that classifier safely needs statement
phase evidence, rather than treating a later successful ROLLBACK as proof.
No throughput campaign, push or publication was performed.


### Fix-round full verification

Counts are per run, not a sum of unique tests; targeted suites overlap.
Rust-case counts are shown except where commands/runs are explicitly named.

| Check | Passed | Failed | Detail |
| --- | ---: | ---: | --- |
| Full core | 1,311 | 0 | 49 targets; 533 ignored |
| Full `snapback4` binary tests | 626 | 0 | 75 ignored |
| Full binary build | 1 | 0 | command, Postgres enabled |
| G7.3 | 7 | 0 | includes cumulative expiry, unknown window and uncancellable COMMIT |
| All G7, private PG16 | 90 | 0 | PG17-only cases run separately |
| E core / HTTP | 40 / 5 | 0 / 0 | explicit opt-in regression suites |
| Private PG17 | 2 + 7 | 0 | certificate timeouts + G7.3 |
| HTTP authority witnesses | 87 | 0 | both stores |
| RT0 core / HTTP | 6 / 10 | 0 / 0 | eligible S remains two flights |
| Wire observer | 4 | 0 | runs: normal plus three cuts |
| E crash/kill matrix | 11 | 0 | zero acknowledged loss; no lost-history reader release |
| `bash scripts/test-postgres.sh` | 816 | 4 | 26 Rust targets; exit 1; evaluator additionally blocked |
| Public serving milestone | 1 | 0 | script; release/restore, changes/sync, deploy/serve and wire parity |
| SQLite-only build / `ref-check` | 1 / 1 | 0 / 0 | commands; 569 LLP docs, 12,048 refs, 0 errors/unchecked |

The Postgres script's four Rust reds are recorded without hiding retries:

- Inherited `both_stores_all_public_boundaries_and_write_observations`:
  unsupported accounting reports `E_INPUT: 6`.
- Additional `log_plan_hygiene_cold_backend_tail_scan_witness`: upgraded
  slope **99.588766 µs/member**, outside its `<70` margin. Zero-scan checks
  pass; this is the direct-SQL timing arm, outside the changed final path.
- Additional `g72_first_ticket_deadline_never_reruns_later_deadline_peers`:
  the four-thread battery sees a later peer succeed, violating the fixture's
  all-error expectation. The same case passes in the serial G7 suite.
- Additional `parallel_matches_serial_overlay_postgres`: the chain's
  grouped outcomes expire with `program invocation's remaining deadline
  elapsed`, while its serial comparison succeeds.

The inherited evaluator lockfile still refuses `--locked`; that evaluator
stage is blocked before executing tests. Its previously known `40001` red
is therefore not re-executed in this run. The script continues through all
other stages, including the passing overlap corpus (22/0) and public
serving milestone. No unrelated threshold or test deadline was weakened.


After the complete battery stopped, one fresh private-PG16 follow-up run
passed **5/0** cases: the cold-plan witness (fresh slope 21.795, upgraded
9.504 µs/member; legacy negative control 310.549), both deadline/differential
cases on the current binary (2/0), and those same two cases on the retained
pre-fix WF binary `/tmp/wf-after-core` (2/0). The original concurrent
battery result remains **816/4**; these isolated passes do not replace it.
The stricter cumulative-budget witness remains green with no code changes
throughout verification.

Every private cluster is stopped: **16 starts across
10 directories**, each confirmed by
`pg_ctl status=3` and no `postmaster.pid`. A fresh birth-checked audit of
**10,651 PID/birth pairs across 8 runs**
finds **0 living helpers or zombies**. Minimum free disk was
**31.92 GiB**, above the 25 GiB stop threshold.
Reclaimed 6.57 GiB from 44 completed integration-test executables in this
worktree's own target directory while retaining active/remaining binaries.
Raw logs, custody records and baseline artifacts remain outside Git under
`/tmp/wff1-*` and `/tmp/wf-*`. No push, publication or throughput campaign.


## WF fix round 2 — delivery reserve and COMMIT-entry witness

Input is `e8c2e34d56`, same commissioned host/worktree and private-cluster
custody, Cargo `-j 5`, line-tables-only, no throughput campaign. Stage P is
routed to the separate `~/projects/sb4-s10a` evaluator workspace.

**P2.** Before the fix, the socket proxy held the real batch opener and
final request for 300,271 / 300,086 µs on one connection. The final still
sent 997,960 µs of server budget; its 751,354 µs tail fit that budget but
completed 1,069,488 µs after the client clock sample (69,488 µs past expiry).
The regression failed 0 passed / 1 failed: xid **committed**, COMMIT-entry sequence called,
and COMMIT plus idle ReadyForQuery on the wire.

The physical writer now retains 32 successful non-final batch-call timings
and subtracts their maximum full RTT plus 5 ms from the remaining deadline
after encoding. The minimum reserve is 5 ms. This prices observed driver
scheduling, transport, server work and return transit conservatively, using
existing flights. No positive headroom causes a known rollback before final
dispatch; the reserve is never clipped to make a deadline fit. An oversized
reserve only rolls back early. A new delay exceeding the historical reserve
can exceed this estimate; it is not an arbitrary-delay guarantee. The
existing uncancellable COMMIT can still finish after its entry deadline.
The governing pipelined-commit §4.4 and parent round-trip §3.5/store-port
§5.2 carry that qualification.

**P3.** The original cumulative witness now checks `is_called = false` as
well as `last_value = 1`. A temporary negative control made exactly one
`nextval('wf_commit_entered')` call after the acknowledged rollback, before
the probe: the original assertion falsely passed **1/0**; the strengthened
assertion correctly failed **0/1** at the COMMIT-entry check. Both runs had
aborted xids and completed the same ticket/tail work. The injected call was
removed before final verification. The earlier round's `last_value`-only
probe did not independently prove zero COMMIT entry.

The fixed delayed wire run passes **1/0**: reserve 306,274 µs, wire budget
691,762 µs, forwarding 300,112 µs, tail 751,277 µs and elapsed 1,058,399 µs.
The xid is **aborted**, `is_called = false`, and the wire requires `S4006`,
ReadyForQuery `E` and no COMMIT tag. The first focused Rust run already
passed; the proxy's exact-two-delay assertion exposed a later inspection
read being delayed too. Disarming after the final fixes that harness issue.
The complete repaired wire set passes **14/0 across five runs** (10 G7.3,
three transport cuts, one delayed-forwarding case).

The default reserve, retention of the high sample through 32 observations,
window rollover and connection isolation are checked directly. An oversized
20 s sample with 10 s still remaining proves acknowledged rollback before
`start_final_dispatch`, with no head advance or retained receipt/effect.
Original member deadlines and the existing recovery classification remain
unchanged. PG16 G7.3 passes **10/0**, E core **40/0**, all G7 **93/0**
(including the eligible-S two-flight ratchet), private PG17 **2/0 + 10/0**.
The proxy-only case executes in its dedicated delay run; bulk suites leave
that mode unarmed.

The first full-core attempt was interrupted by the 25 GiB disk floor.
All recorded children and its private cluster were stopped and confirmed;
8.27 GiB of stale duplicate executables in this worktree's own target were
removed, restoring 29.72 GiB. The incomplete core result is discarded;
completed G7 evidence was retained and full core was restarted.

| Check | Passed | Failed | Notes |
| --- | ---: | ---: | --- |
| Full core | 1,312 | 0 | 49 targets; 535 ignored |
| Full `snapback4` binary | 626 | 0 | 75 ignored |
| All G7 / G7.3 | 93 / 10 | 0 / 0 | Includes eligible-S two-flight ratchet |
| E core / HTTP | 40 / 5 | 0 / 0 | Opt-in E protocol retained |
| HTTP lever witnesses | 87 | 0 | Authority and retry cuts |
| RT0 core / HTTP | 6 / 10 | 0 / 0 | Eligible S remains two flights |
| Private PG17 E / G7.3 | 2 / 10 | 0 / 0 | Real PG17 timeout reset cases |
| Wire suite | 14 | 0 | Five runs, including all three loss cuts and delivery delay |
| E crash/kill matrix | 11 | 0 | Zero acknowledged loss or lost-history release |
| `bash scripts/test-postgres.sh` | 819 | 1 | 26 Cargo targets; inherited `E_INPUT: 6`; exit 1 |

The Postgres total counts Cargo targets; its nested one-test subprocess
witness is not counted a second time. Its only failed Rust test is
`both_stores_all_public_boundaries_and_write_observations`, with
`runtime_refused_unexpected: { "E_INPUT": 6 }`. The separate Stage P command
in `sb4-s10a` is blocked by its inherited stale evaluator lockfile under
`--locked`; the previously known `40001` case therefore **did not run**.
No additional red appeared. In particular, the cold-plan timing witness,
`g72_first_ticket_deadline_never_reruns_later_deadline_peers` and
`parallel_matches_serial_overlay_postgres` all pass in this full run.
Public Postgres serving completes successfully, including release parity,
restart/takeover, actual G6 owner declaration and the maintained-count
fixture with 24 seeded messages plus one public post. No throughput campaign was run.

The full binary build and SQLite-only check pass. `./ref-check --verbose`
passes: **569 LLP documents, 12,049 references, 0 errors, 0 unchecked**.
After full core passed, another 6.57 GiB of completed core-only integration
executables were reclaimed from the owned target; all remaining Postgres
executables and libraries were retained. Verification continued over the
same code/test/script fingerprint:
`9b6aaa60fa937a1b56a2f5cb1d6c6c50a140774d415c13bd5889eeb36cb9da25`.

The independent final audit covers **9,697 unique PID/birth pairs** and
**11 private cluster directories** across the negative controls, fixed
witnesses, interrupted/restarted verification and crash/serving helpers.
Every cluster reports `pg_ctl status = 3`, with no `postmaster.pid`; no
recorded process or unexpected worktree test helper remains. Final free
space is 33.62 GiB. No push, publication, protected-cluster access or raw
logs committed.
