# Stage P: ordered Postgres server cost

Lane `sb4-pg/stage-p`, base `5fc6e6449b`, host `expo-build-450a`
(OS hostname `expose-builder-nothing`). No WF changes or concurrent-disjoint
writer/reader implementation are included. No push or publication occurs.

## P0, before implementation

The first attribution used the unchanged S1 schema, all 256 users, 1,025
rooms, 8,448 memberships and 257 counters, but **zero messages**. It is a
diagnostic, not the authoritative million-message S1 fixture. In particular,
the small population makes the old JSON tail choose a sequential scan of `r`.
The later paired million-message run is the primary performance comparison.

These release runs use private socket-only PG16.15, 32 closed-loop HTTP
clients, no added database delay, three seconds warmup and ten seconds per
cell. W4 uses one counter per principal; the initial diagnostic's W5 mix has
25% shared-key clients; W5 same uses the shared counter for every client.
The paired full-fixture harness uses S1's **1% hot-key** mix instead.
There is no open-loop arrival-rate/SLO qualification here. Concurrent host
load is recorded; these are local cost and residence observations.

`pg_stat_statements.track_planning=on`, top-level tracking, JIT off, and 1%
sampled `auto_explain` analyzed/timed JSON plans supply the server clocks.
Per-batch values include execution **and** planning, divided by physical tail
calls, including solo tails. Batch size is the durable sequence delta divided
by those calls. Raw queries, credentials and logs stay outside Git under
`/tmp/stage-p-20261026/`. Aggregates are in `attribution-before.json`.

| Initial diagnostic, ms/batch | W4 | W5 mix, 25% | W5 same |
| --- | ---: | ---: | ---: |
| Mean N | 10.55 | 10.63 | 10.60 |
| Settings guard | 0.133 | 0.185 | 0.183 |
| Owner fence | 0.159 | 0.176 | 0.175 |
| Facts, identity, receipts | 0.271 | 0.316 | 0.327 |
| Tail | 2.458 | 3.022 | 3.072 |
| Other controls | 0.015 | 0.017 | 0.017 |
| Non-wait subtotal | 3.036 | 3.716 | 3.774 |
| Advisory-ticket wait, separately | 3.336 | 3.472 | 3.362 |

The supplied fit is `2.4 + 0.086N` ms across P1 and the tail: about 3.31 ms
at N=10.55. The diagnostic's non-wait subtotal is 3.04 ms. This is a
component attribution at observed N, **not** a new measurement of the
intercept. Guards/fence explain only 0.29 ms; the tail is the first cut.
Advisory waits overlap the ordered chain and are not additive CPU.

Sampled tail CTE clocks, across 57 plans, average: head 0.027 ms, images
2.026, commits 0.154, evidence 0.169, pruning 0.703, empty log 0.106, empty
effects 0.108, presence 0.001 and empty receipts 0.087. These clocks include
dependencies/materialization and **must not be summed**. All 57 image plans
scan `r`; the post-change small-fixture samples use `r_pkey` instead. That
plan switch is not assumed to occur on the million-message fixture.

PG process CPU per committed write is approximately 364/433/436 us for these
three cells. The earlier supplied N≈11 anchor is 263–300 us, versus G7.0 arm
C's 134 us at N=16. Different populations, batch sizes and HTTP versus SQL
harness work prevent treating those as a measured delta. The full-fixture
paired run below supplies the within-run comparison.

COMMIT's `pg_stat_statements` utility clock is only about 0.0004 ms; it
excludes the transaction-end flush. A second baseline with 2% sampled
completed-statement duration logging measures 90 COMMIT samples averaging
5.25 ms, including setup. Its W4 residence is 22.99 ms versus 17.29 ms
without that logging. Flush and logging disturbance therefore remain separate
from the non-wait statement ledger. The paired run uses identical sampling
settings for both binaries.

## Full-fixture P0 and result

The primary pair reuses one private PG16 database containing all **1,000,000
native Engine-seeded messages**, first with the baseline binary and then the
compact Stage P binary. Both use release builds, 32 closed-loop clients, the
same statement/plan sampling, and the unchanged S1 schema. There is no added
RTT. The 1% hot-key mix follows S1. Every measured request succeeds. Binary
hashes, clocks, batch sizes, CPU, load samples and commit sample counts are in
`loopback.json`. The preceding million-message trial overlapped builds and had
deadline/queue/unknown-outcome errors; it is excluded from performance claims.

| PG execution + planning, ms/batch | W4 before → after | W5 1% mix before → after | W5 same before → after |
| --- | ---: | ---: | ---: |
| Mean N | 10.56 → 10.33 | 10.54 → 10.62 | 10.61 → 10.61 |
| Settings guard | 0.138 → 0.040 | 0.164 → 0.042 | 0.183 → 0.053 |
| Owner fence | 0.162 → 0.044 | 0.182 → 0.050 | 0.172 → 0.056 |
| Facts/identity/receipts | 0.288 → 0.271 | 0.306 → 0.282 | 0.334 → 0.332 |
| Tail | 0.543 → 0.243 | 0.608 → 0.254 | 0.459 → 0.185 |
| Other controls | 0.017 → 0.015 | 0.020 → 0.016 | 0.018 → 0.018 |
| Off-path evidence maintenance | — → 0.008 | — → 0.005 | — → 0.017 |
| Non-wait subtotal, maintenance included | 1.149 → 0.620 | 1.281 → 0.649 | 1.166 → 0.662 |
| Ticket waiting, separately | 6.081 → 4.439 | 4.385 → 5.458 | 4.544 → 5.166 |
| Completed COMMIT, sampled mean | 9.329 → 5.779 | 5.979 → 6.674 | 6.598 → 7.514 |

The supplied ≈2.4 ms intercept comes from the earlier P1+tail server-residence
fit. This root-statement ledger does not fully attribute it. At N≈10.6 its P1+tail formula predicts ≈3.31 ms; the full
fixture's root statement ledger is only 1.15–1.28 ms before these cuts.
Parsing/EXECUTE argument work, transport scheduling and waiting must not be
assigned invented values to force equality. The fixed-N control below measures
completed statement duration and backend CPU to expose that missing work.

| 32-client loopback | W4 before → after | W5 1% mix before → after | W5 same before → after |
| --- | ---: | ---: | ---: |
| Mean residence, ms | 25.51 → 19.66 | 21.26 → 22.44 | 22.29 → 23.36 |
| p99 residence, ms | 47.37 → 35.02 | 39.06 → 43.42 | 40.45 → 42.97 |
| PG CPU per committed write, us | 181.75 → 129.03 | 202.77 → 129.07 | 186.08 → 137.24 |
| Request errors | 0 → 0 | 0 → 0 | 0 → 0 |

PG CPU falls 29.0%/36.3%/26.2%. W4 residence improves 22.9%; W5 means regress
5.5%/4.8%, accompanied by higher sampled COMMIT and ticket-wait clocks. The
host load is recorded for every phase. This short pair does not isolate those
flush/load effects and supplies no capacity-rung or one-host S1 claim.
The supplied 263–300 us N≈11 anchor is reproduced approximately in the first
busy full-fixture trial; the final pair's baseline is lower. The 134 us G7.0
arm C/N=16 reference remains contextual because its harness and batch size differ.

## Marginal cuts and witnesses

`tail-ablation.json` is an eight-order, 1,000-attempt/order control at fixed
N=11 in a synthetic million-row database, with a forced generic plan. Each
attempt rolls back and checks all eight returned counts. All **40,000 count
checks pass**. It prices the tail, without HTTP, application interpretation,
guards, or commit fsync. The completed-statement samples include parsing and
argument construction; backend CPU is the backend's `/proc/self/stat` delta,
including the equal rollback controls. Values below are medians unless marked.

| Tail form | Exec + plan, ms | Completed statement mean, ms | Backend CPU, ms |
| --- | ---: | ---: | ---: |
| Original JSON, all CTEs, prune | 0.439 | 0.534 | 0.585 |
| Per-element typed arrays, all CTEs, prune | 0.213 | 0.523 | 0.555 |
| Typed arrays, empty CTEs omitted, prune | 0.197 | 0.424 | 0.455 |
| Typed arrays, empty CTEs omitted, no batch prune | 0.194 | 0.425 | 0.455 |
| **Compact typed array inputs, no batch prune** | **0.215** | **0.294** | **0.340** |

Per-element arrays move work out of the root executor into SQL argument trees;
compact array values remove that cost. The final tail cuts completed statement
mean 45.0% and backend CPU 41.9% against JSON. Empty-family omission has a
measurable CPU benefit. Pruning's marginal cost is within this control's noise;
its move is retained for the explicit head-bound retention contract and to keep
maintenance off application batches. There is no claimed independent pruning
speedup. Per-version helper functions save W4 about 0.217 ms/batch across guard
and fence in the full-fixture statement ledger.

The compact transport encodes one array input per typed column and casts once
to qualified `text[]`, `int8[]` or `bool[]`. It does not reconstruct a JSON
recordset. The independent binary-array oracle verifies NULL versus empty and
literal NULL, quotes, backslashes, Unicode, controls, integer endpoints and SQL
punctuation. Randomized all-family and empty online-only histories compare
outcomes/meters and byte-identical generic/typed PG durable snapshots, plus
SQLite with its physical cap table IDs normalized to names. The warm empty
shape proves generic-plan use.

Opening installs helpers under the existing inline owner fence and head lock,
only if absent. Exact signature, owner, search path, language, security,
volatility, argument attributes and body are admitted. Tampering refuses both
open and lease connection. Missing guard or fence returns HTTP 503 with zero
sequence change; both new expectations fail on the baseline, which has no
helpers and commits the request. Reopening that baseline store installs both
helpers. Existing functions retain their OIDs. Old versions are retained;
privileged runtime DDL during a serving lease remains unsupported.

The raising fence stays volatile, key-share, and a separate command before data.
A missing helper is referenced on each ordinary flight, including binary reads
at Parse. Reconnect invalidates prepared state and validates catalogs before
reattaching the broken durability epoch; the initial version incorrectly waited
on that epoch and failed the E disconnect oracle. That failure is corrected.

Lease maintenance skips a busy head, locks/republishes an available head, and
prunes only at `_head.seq - 1000` in that transaction. A delayed older snapshot
retains all 1,000 evidence rows through MVCC, a new reader binds the new head,
and a busy head does not block renewal. Renewal notices a schema upgrade that
completed after the lease connected. Application tails contain no evidence delete.
SQLite product code, exact count checks, outcome policy, G6 and opt-in E routing
are unchanged. The WF lane is not included; later integration must recheck the
constructor/flight/catch-up overlap against WF.

## Verification and custody

Final check totals and PID census are recorded below.
The initial binary attempt lacked the ordinary debug CLI needed by its worker
and witness launcher; building it resolves all 28 failures. G7's PG17-only cases
are run on private PG17, separately from the serial PG16 suite. A parallel
lever run hit a ticket deadline; its complete serial rerun passes 87/0.

Reproduction scripts are `experiments/scale-controls/scripts/stage-p.py` and
`experiments/scale-controls/scripts/ablate-stage-p-tail.py`. Raw outputs must
remain outside Git. The native seed helper's stale standalone lockfile was
avoided with an external temporary package using the root lock and the unchanged
helper source; no repository lockfile is changed. All Cargo calls use `-j 5`,
the assigned target and line-tables-only dev/test debug settings; measurements
use release. Only recorded PIDs are stopped. Port 55440 and `~/q24` are untouched.
A 2.97 GB inactive lane-owned release incremental cache was removed after
confirming no compiler used it; the /home stop threshold was never crossed.

Fresh source review found one further reconnect admission defect: after a failed
helper catalog check, a later request on the same replacement reader connection
could select legacy inline checks. Validation remains pending after failure.
The regression witness fails on `1e1bf2925e` with `guard/missing admitted retry 1`
and covers missing and altered guard/fence helpers, three refused retries, and
restoration. This admission-only correction leaves the measured steady-state
SQL unchanged; `loopback.json` binds the measured release binaries by SHA-256.
The initial review's other implementation paths had no material findings.

## Final verification and process custody

The final source is `c0d78c37a1856af8c5c10a57e2edcfc1a3960fec`.
A fresh read-only review of that commit reports **no material finding remains**.
The completion commit changes documentation only. Measurements remain bound to
the release binary hashes in `loopback.json`; the final reconnect correction
changes failed admission, not the measured steady-state SQL.

| Check | Passed | Failed | Ignored / qualification |
| --- | ---: | ---: | --- |
| Full core, postgres feature, all ordinary targets and doctests | 1311 | 0 | 533; plus one passing isolated child run |
| Full snapback4 binary, postgres feature | 626 | 0 | 75; plus 13 passing isolated child runs |
| Stage P focused witnesses | 7 | 0 | all private witnesses enabled |
| Serial PG16 G7/E | 83 | 0 | PG17-only cases run separately |
| Private PG17 E certificate witnesses | 2 | 0 | final source; tampered-attributes witness also 1/0 |
| Lever suites in complete Postgres script | 87 | 0 | complete current rerun |
| RT0 core / HTTP Postgres / SQLite | 3 / 8 / 1 | 0 | exact flight ratchets unchanged; SQLite source unchanged |
| Complete Postgres script, Rust summary totals | 824 | 1 | 27 summaries; inherited fixed-seed store refusal only |
| Public Postgres deploy/serve witness | 1 | 0 | includes both-store parity, retention, bootstrap, takeover, crash and S1 Quarry checks |
| ref-check | 569 documents | 0 | 12054 references, zero unchecked |

`bash scripts/test-postgres.sh` exits **1**, not a pass. Its sole Rust test
failure is `both_stores_all_public_boundaries_and_write_observations` with
`E_INPUT: 6` on both stores. The inherited evaluator `Cargo.lock` refusal is
also reproduced; the evaluator's known `40001` stage is **not reached**, not
counted as passed. There are no additional unresolved reds. The initial stale
pruning/solo-tail witnesses and public retention expectation are fixed, and
all pass in this complete rerun. The earlier missing debug CLI and parallel
lever deadline are resolved by the built launcher and successful full/serial
reruns; the reconnect admission defect is covered by its failing pre-fix
control and passing final witness.

Final cleanup audits **38 PID ledgers, 25796 recorded entries**, including the
three public-witness cluster directories, and finds **zero living processes,
zero zombies, zero unexpected lane executables, and zero postmaster PID files**.
The interrupted public run's recorded orphan master `500388` was stopped and
confirmed gone with all five children. Its already-dead outer master `500350`
was independently checked with `pg_ctl status` (3, no server); its stale PID
metadata is preserved outside Git after clearing the active PID-file path.
The final PG16 and PG17 controllers both confirm stopped clusters and no leaks.
Completion free space is **28.53 GiB**; the 25 GiB stop threshold did not trigger.
Only recorded PIDs were stopped. No push occurred; the shared port-55440 PG17
cluster and `~/q24` were untouched. Raw logs, PID ledgers and databases remain
outside Git under the recorded `/tmp` paths.
