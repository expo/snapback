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
