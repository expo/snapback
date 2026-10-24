# G3b: bounded S1 execution over a batch-local overlay

Lane `sb4-pg/g3b`, base `b3c4aa2bba`, expo-build-450a, dedicated warm target
`sb4-rt12f2/snapback4/target`, six Cargo jobs and line-table debug information.
This is a private PG16 loopback diagnostic, not a matched S1 scale claim.

## Executor as built

The existing committer owns the fenced transaction and its outcome protocol.
A conservative IR/schema pass closes every possible argument-addressed point
and every supported one-hop unique rule probe, including absent and hidden
answers. The sum of schema-declared row decode reservations is limited to
32 MiB for root/probe collection; excess takes the serial path. It collects all
branches; only immutable comparisons prune a rule branch. Generation 1 limits
this first qualification to stores without prior
activation transitions. Programs must update ordinary existing rows without
changing index keys or populations. Maintained families, caps, allocators,
time/presence, effects/assets, dynamic addresses, general scans and unsupported
shapes retain the serial path. Mixed groups split at known serial boundaries.

Each dependency level is one composed PostgreSQL data-access statement for all
members, including absence. The first level shares a flight with composed
session, bound-receipt and placement facts. Rust samples authority deadlines
and uses the ordinary resolver at each member's serial position. The existing
checked owner-fence and post-head generation opener remains separate from
fact collection; this is not the optional three-/two-flight opener protocol.

Absence and unique-index spans are recorded. Eligible members cannot change
populations or index keys, so span membership stays fixed within a wave.
Every returned probe image, including a hidden image, records its row identity
and conflicts with an accepted predecessor's write. Authority and keyed
receipts retain the existing per-member resolver and ordered protocol handling.

Private attempts read their own images, accepted predecessors and immutable
base facts. Read recording sits at the row/program boundary. Uniform public
points also use the overlay through the by-id scan and selected/priced point
interfaces, with the stores' shared canonical-image charge before cloning.
Disjoint attempts execute once against the base. A later attempt whose observed
row was written by a predecessor discards its images and meter and executes
again after that predecessor with no body access to the database. Known hot
colliders execute once, serially in memory. No later tentative write is visible
to an earlier member. An unexpected family fails closed, aborts the buffered
attempt and takes the existing serial recovery path without removing a member.

PostgreSQL sends one verified CTE applying the final distinct row images and
the complete vector tail, then sends uncancellable COMMIT separately. Counts
cover images, head, commits, change evidence, log images, effects, presence and
receipts. Per-member outcomes/events/receipts keep intermediate images even
when a successor overwrites the final physical row. SQLite uses the same Rust
executor and point semantics with its local access and protocol recorder,
applying buffered row images before its single physical COMMIT. Confirmed
rollback is required for retry; ambiguous COMMIT makes every member unknown,
including tentative refusals. Continuations and responses wait for durability.

## Correctness evidence

The new randomized oracle uses three seeds, 192 members per seed, N=8/32 versus
N=1 on each store: 12 complete paired histories. It compares every outcome and
meter, durable rows, raw receipts/bindings/times, sequence state, changes,
commits, intermediate log images and effects. Adversarial histories include
same-key collisions, absent targets, shared membership authorization, hidden
rule failures, refusals after tentative writes, duplicate keyed receipts and
mixed serial boundaries. A separate 16-member chain forces 15 recorded
conflict reruns on each store. A public synced counter checks all intermediate
returned/logged images, including a mid-batch refusal.

Boundary faults cover composed facts, both read levels, every member/program
frame and release, apply/tail and COMMIT. A real PG trigger suppresses image
updates and proves count rejection rolls back history. A real owned writer is
held in deferred COMMIT, its recorded backend is terminated, every member gets
`E_COMMIT_OUTCOME_UNKNOWN`, and a new fenced owner retries/replays keyed intent.
Late unknown-family witnesses preserve all members through serial recovery.
Oversized root and rule-probe declarations exercise the fact-storage fallback
before decoding on both stores.
The inherited G2/G3 oracle continues to exercise maintained rows, allocations,
effects, savepoint/tail faults, and fresh time/presence on fallback.

## Controlled RT0

The controlled live-account core boundary excludes HTTP ingress. PostgreSQL
counts are exchanges; SQLite counts are local statements. Existing HTTP N=1
classes keep their allowances. The binary ratchets additionally retain the
same-owner hot counter group and add N=8.

| Workload | N | PG total / per member | SQLite total / per member |
| --- | ---: | ---: | ---: |
| W4 disjoint | 1 | 7 / 7 | 21 / 21 |
| W4 disjoint | 8 | 5 / 0.625 | 94 / 11.75 |
| W4 disjoint | 32 | 5 / 0.15625 | 358 / 11.1875 |
| W5 shared | 1 | 10 / 10 | 24 / 24 |
| W5 shared | 8 | 6 / 0.75 | 59 / 7.375 |
| W5 shared | 32 | 6 / 0.1875 | 203 / 6.34375 |

W4 uses the existing two-flight authorized opener, one fact flight, apply/tail
and COMMIT. W5 adds the membership level. Rust CPU work remains serial, without
overlap with collection or COMMIT. The zero-flight rerun claim concerns the
qualified Rust program body, not SQLite's ordinary local protocol records.

## Qualification and measurements

| Check | Result |
| --- | --- |
| Normal `cargo build --locked -j 6 -p snapback4` | Pass |
| Full core, `--features postgres --no-fail-fast` | Pass: 742 unit tests, 289 named unit ignores; every unignored integration target and 38 doc tests pass |
| Full `snapback4` binary, `--features postgres --bin snapback4` | Pass: 577 tests, 45 named ignores |
| Both RT0 ratchets, `round_trips_ --include-ignored` | Pass: five tests; PG N=4/8/32 totals 5/5/5; SQLite 34/58/202 |
| `bash scripts/test-postgres.sh` | **Red:** retained evaluator Serializable `40001`; all subsequent scopes and the public CLI witness pass |
| `./ref-check` | Pass: zero errors and unchecked references; repeated after final documentation |

The 36-case program-batch scope passes on the private cluster, including the
new overlay oracle and fault witnesses. The script also passes 232 adapter,
25 ownership, 60 evolution, 19 literal/codec, 13 change-evidence, 15 command,
six outcome/deadline, 62 HTTP-boundary, 22 five-executor corpus,
11 differential-library and four store-campaign cases. Public serving passes
byte/meter restoration parity, large change evidence, restart/takeover,
ownership loss and unchanged S1 Quarry P1-MC.

The full script retains
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`:
SQLSTATE `40001` at the unchanged increment unwrap and its join. Conformance
finishes 21 passed / one failed / three existing exclusions. This matches the
[open evaluator ticket](../../../issues/20260916-snapback4-postgres-serializable-benchmark-failures.md)
and the G2/G3 baseline; no retry, timeout, durability or exclusion policy changes.
No clean full-script qualification is claimed. The initial full-core command
found an unnecessary private-trait import in the new measurement harness;
removing that import lets the complete rerun pass.

Raw logs, per-request samples, JSON and PG data stay outside Git.

## Private PG16 TCP loopback diagnostic

Actual S1 `increment`, live account credentials, one fenced owned queue and 32 closed-loop writers. W4 uses 32 owned counters; W5 uses one shared counter and the membership check for every principal. Each target runs three trials in counterbalanced order `1,8,32,32,8,1,1,8,32`, separately per workload, with one-second warmup and three-second timed phases. Elapsed time includes thread/barrier setup and final drain. HTTP, ingress/response encoding, delay injection and the million-message fixture are excluded. Cargo test profile: opt-level 1, line-table debug info, six build jobs. Heavy qualification finishes before timing.

Postgres: PostgreSQL 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit. Durability settings: `{"fsync": "on", "full_page_writes": "on", "synchronous_commit": "on"}`. TCP loopback `127.0.0.1:55475`, lease renewal every 700 ms.

| Workload | Max N | Writes/s median (range) | Flights/batch median | Mean fill median | Request p50 / p99 ms, medians |
| --- | ---: | ---: | ---: | ---: | ---: |
| W4-disjoint | 1 | 173.6 (173.4–177.2) | 7.000 | 1.00 | 182.62 / 207.58 |
| W4-disjoint | 8 | 904.8 (886.9–931.3) | 5.000 | 7.99 | 34.13 / 48.88 |
| W4-disjoint | 32 | 1883.5 (1861.2–1895.9) | 5.000 | 31.84 | 16.46 / 27.50 |
| W5-shared | 1 | 162.2 (159.8–166.6) | 10.000 | 1.00 | 189.69 / 254.17 |
| W5-shared | 8 | 891.2 (877.8–962.6) | 6.000 | 7.99 | 34.84 / 47.19 |
| W5-shared | 32 | 1808.4 (1798.6–1830.5) | 6.000 | 31.81 | 17.34 / 24.18 |

Measured flights include the actual fill distribution, cold-small tail batches and serial N=1 groups; the controlled RT0 table above gives the warm full-batch schedule. Every trial checks exact durable counter totals, histogram/member/physical-commit agreement, successful outcomes and disappearance of both recorded owned backends after dropping the queue. These measurements are local diagnostics, not a write-SLO or scale-control verdict.

| Workload | Max N | Combined batches | Actual fill → batch count |
| --- | ---: | ---: | --- |
| W4-disjoint | 1 | 1669 | 1→1669 |
| W4-disjoint | 8 | 1034 | 4→2, 5→1, 8→1031 |
| W4-disjoint | 32 | 533 | 2→1, 5→1, 12→1, 31→1, 32→529 |
| W5-shared | 1 | 1559 | 1→1559 |
| W5-shared | 8 | 1038 | 2→1, 5→2, 8→1035 |
| W5-shared | 32 | 514 | 3→1, 4→2, 28→1, 29→1, 31→1, 32→508 |

Timed-phase window: 2026-10-24T02:32:09+00:00 through 2026-10-24T02:33:55+00:00. Recorded one-minute load: **4.52–5.47**; available affinity: **12 CPUs**. Shared-host variation remains in the ranges. No raw samples or logs are committed.

## Process cleanup and custody

The qualification/measurement PG16 postmaster **1173735** and public-witness
postmaster **1443643** are stopped. Independent `pg_ctl status` returns 3 for
both recorded data directories; neither has a postmaster pidfile or socket,
and no listener remains on the owned TCP port. All **4,726 recorded processes**,
including the measurement backends and both monitors, are absent. A separate
scan finds no executable from this lane's target still running. **PIDs left:
none.** Final observed `/home` free space is 78 G; recorded checks remain above
the 40 GB stop threshold. Raw logs, JSON, samples and PG data remain outside
Git. No push, stash, global Git configuration change or q24 operation occurs.

Implementation/witness commits: `f204a68d48`, `6ae26697c4`, `86ffb37cf2`,
`d65e9ba2e1`, `e428c02898`, `01bfd3a9ef`; RT0/measurement harness:
`5ccfdfd7fa`. Commit attribution remains `Codex <noreply@openai.com>`.
