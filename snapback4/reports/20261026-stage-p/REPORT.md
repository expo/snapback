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

## 2026-10-26 — Stage P fix round 1

Required base `784641ce40`; code commits `fa23547aed`, `f6148eb02a`,
`3b138076e8`; test-only alignment `0a0ee9def0`. Final production code is `3b138076e8efc726d9e5bf117428a384efd2c424`.
The branch/worktree are preserved; no push, publication, WF integration or
throughput campaign occurs. The accepted Stage P mechanism in LLP
3000.009.001.000.000.002 §3.11 is updated (the later `.003` RFC is absent from
this checkout). Fresh read-only review of the final code reports **no material
finding remains**; that reviewer ran no builds, tests or measurements.

### Five findings and behavioral evidence

1. **Fence/data namespace.** The qualified guard takes the caller-evaluated
   `current_schemas(true)::text[]`, before its own pinned function path applies.
   Product connections pin `store,pg_catalog,pg_temp`. The guard requires store
   then catalog, followed only by this session's own temporary schema if one
   exists. The temporary namespace cannot precede/shadow durable data. This
   adds a predicate to the existing flight rather than qualifying every data
   statement or adding another flight. The same-generation A→B drift witness
   admits a write on the original code and refuses after the fix, before either
   head or counter image changes. The volatile key-share fence remains its own
   command before facts and writes.
2. **array_nulls.** Connection qualification pins it on, including asynchronous
   reader setup; inline/provisioned guards reject later off before data. This
   keeps the measured compact transport instead of rebuilding per-element SQL
   arrays or changing the wire protocol. Text-array encoding is explicitly
   setting-dependent. The original code admits a post-qualification off write;
   the fix refuses it without a head/image change. The expanded randomized
   oracle starts with both on/off, qualifies the sessions, then compares full
   outcomes/meters and durable snapshots across generic PG, compact PG and
   SQLite: three seeds × three shapes × two settings, 192 randomized invocations
   per history, plus explicit grouped deletes. SQL assertions require NULL log
   tombstones and nullable integer effect deadlines. The same final oracle is
   replayed against the original array/settings code as a failing-before control.
3. **Per-digest installation.** Each admitted digest has its own `_meta`
   signature/body contract. All recorded versions validate, including newer
   names unknown to an older binary. Only unrecorded names can be installed,
   create-only under the inline owner fence/head lock; a missing or incompatible
   admitted function refuses. Legacy boolean-marker import validates the exact
   original definitions first. Nonempty contracts stay authoritative even if an
   original v1 binary rewrites its marker to 1. The version witness fails before
   at v2 open, passes with both versions, unchanged v1 OIDs/definitions and v1/v2
   writes, then refuses a dropped admitted newer function. Existing upgrade,
   missing-function and reconnect witnesses pass. The real release pair also
   exercises original-v1 open followed by the new upgrade without resetting
   metadata. No older function is replaced or removed by installation.
4. **Doctor.** The shared read-only catalog validator checks signature/result,
   owner, pinned search path, language, security, volatility, parallel/strict/set/
   argument/default attributes, digest and body. Both guard/fence tamper matrices
   run through doctor/open/lease. The actual CLI control ALTERs a recorded guard
   SECURITY DEFINER: the original doctor exits 0, the final doctor exits 1 with
   `E_STORE_OWNERSHIP`. Exact definitions are restored before measurement. Doctor
   diagnoses; it does not seize another process's lease. Privileged runtime DDL
   during an existing serving lease remains outside the supported boundary.
5. **Empty-family witness.** Emitted SQL is checked for all four CAS/publication
   variants: no empty image/commit/evidence/log/effect/presence/receipt CTE and
   seven typed zero counts. A deliberately reintroduced empty log CTE must fail
   this assertion, although its durable result is unchanged.

### Corrections found during this round

The first strict path guard rejected legitimate evolution scratch schemas.
The complete initial script exposed 45 additional Rust failures and a public
CLI evolution failure. The isolated maintained-column control reproduces S4001
on `fa23547aed`. Explicit pg_temp-last pinning plus the guarded last-position
exception resolves all **45/45 individual reruns**; their names/results are in
[the aggregate](fix-round1.json). The expanded temp `_head` witness proves a
normal mutation advances the durable head while its temporary copy stays
unchanged, then requires S4001 when temp moves first.

Fresh review of `f6148eb02a` found one missed pin in writer recovery. The extended
witness fails there only after a recorded writer termination/replacement, with
S4001 on its first post-temp mutation. `3b138076e8` pins that path too; the final
witness covers initial and replaced connections. Failed helper admission stays
pending across retries. No public claim relies on the intermediate strict guard.

The restarted complete script also exposed an old FF3 test assumption:
`activation_scratch_requires_owned_plain_heap` treated a temporary `r` as
shadowing even behind the new path pin. Its unchanged isolated repeat fails.
Test-only commit `0a0ee9def0` makes that case explicitly put `pg_temp` first;
all six DDL variants retain the named managed-relation refusal and generation
rollback assertions. The corrected isolated repeat passes **1/0**, and its complete FF1 group passes
**35/0** at the script's four-thread setting. The script's
earlier stale-test red remains in the totals. No production code changed, so
all product-code qualification and release hashes remain bound to `3b138076e8`.

The final-code full core, binary, G7/E and RT0 checks passed before a shared-host
resource stop interrupted its first Postgres-script attempt. The monitor saw
**24.85 GiB free**, stopped the recorded workloads immediately, and an independent
census confirmed zero living/zombie lane processes and no postmaster PID file.
Only inactive lane-owned incremental caches and confirmed-stopped test data were
removed, retaining source, binaries, raw logs and ledgers. At **38.89 GiB free**,
only the unfinished Postgres script was restarted on a new private PG16 cluster.
The interrupted attempt is not counted as a complete script pass. Code and all
completed-check semantic inputs remain unchanged at `3b138076e8`.

### Brief final-code loopback confirmation

One paired W4 cell: private PG16.15, retained native million-message fixture,
release builds, 32 closed-loop clients, 3 s warmup plus **5 s measured per arm**,
no added RTT, 1% analyzed-plan and 2% completed-statement sampling. No W5/capacity
sweep is run. [Aggregates](fix-round1.json) record hashes, clocks, load and custody.
The original measured Stage P release is the before binary (its later base
reconnect-only correction does not change steady-state SQL); the after binary
is built from final code `3b138076e8`.

| Execution + planning, ms/batch | Before fixes | Final code |
| --- | ---: | ---: |
| Mean N | 8.516 | 9.446 |
| Guard | 0.05544 | 0.05714 |
| Fence | 0.04746 | 0.04151 |
| Tail | 0.22160 | 0.20476 |
| Facts | 0.27272 | 0.26767 |
| Other controls | 0.02098 | 0.01975 |
| Off-path maintenance | 0.01330 | 0.00763 |
| **Non-wait total** | **0.63149** | **0.59844** |
| Ticket waits, separately | 1.18601 | 1.14958 |

Guard cost grows **0.00170 ms/batch**; total non-wait cost does not give back
the Stage P gain. Unequal N and changing load preclude a marginal slope/speedup
claim. The original pre-Stage-P W4 ledger (1.149 ms/batch) remains contextual.
The final pair has **one E_RATE_LIMIT refusal per cell**, no database error:
11,940/11,941 and 13,640/13,641 requests succeed. These cells price server work
per physical committed batch; they do not qualify capacity or an HTTP SLO.
Mean residence is 13.384→11.729 ms, p99 28.502→19.695 ms, and PG CPU per
committed write 158.29→139.30 us. Recorded load (1/5/15 min) moves
0.55/2.69/3.02→1.07/2.77/3.05 before and
1.68/2.84/3.07→2.27/2.94/3.10 after. The earlier clean intermediate-code pair
(0.491→0.545 ms/batch) is retained in the aggregate, not substituted for this
final-code measurement. Both final measurement controllers confirm zero living
or zombie descendants and no postmaster PID file.

### Final checks and process custody

| Check | Passed | Failed | Qualification |
| --- | ---: | ---: | --- |
| Final focused Stage P | 12 | 0 | includes both writer connection paths and durable NULL oracle |
| Full core | 1312 | 0 | 537 ignored; one passing isolated child excluded |
| Full snapback4 binary | 626 | 0 | 75 ignored; 13 passing isolated children excluded |
| Serial PG16 G7/E | 83 | 0 | all enabled PG16 cases |
| Private PG17-only E certificates | 2 | 0 | both transaction-timeout witnesses |
| Levers | 87 | 0 | complete script run |
| RT0 core / PG HTTP / SQLite | 3 / 8 / 1 | 0 | exact flight ratchets unchanged |
| Initial additional failures, individual reruns | 45 | 0 | every named initial Rust red; names in aggregate |
| Corrected shadow fixture / full FF1 group | 1 / 35 | 0 | all six DDL variants; group at four threads |
| Complete Postgres script, Rust summary totals | 827 | 2 | 27 summaries; script exits 1 |
| Public deploy/serve milestone | 1 | 0 | both-store wire/meters, retention, bootstrap, takeover, crash/restart and S1 |
| ref-check | 569 documents | 0 | 12055 references; zero unchecked |

The complete script is **not a pass**. Its two Rust failures are the inherited
`both_stores_all_public_boundaries_and_write_observations` (`E_INPUT: 6`) and
the old shadow-fixture execution before its test-only correction. The latter
passes its corrected isolated repeat and entire 35-test FF1 group, retaining
all named refusal/rollback assertions; it is not an unresolved product failure.
The inherited evaluator Cargo.lock refusal also reproduces. Its known `40001`
stage is **not reached**, not counted as passed. No other unresolved red remains.
The full core/binary/G7/E/RT0 product checks bind production `3b138076e8`; the
subsequent `0a0ee9def0` changes only the ignored FF3 test setup, RFC and journal.
The public evolution/retention/S1 witness completes successfully on the final
production implementation. No expensive unchanged check is silently substituted
for an unrun result.

Final cleanup audits **28 ledgers / 18722 recorded PID identities**, including
two public-witness cluster directories. It finds **zero living processes, zero
zombies, zero unexpected lane executables and zero postmaster PID files**.
Independent pg_ctl status probes return 3 for both final PG16 and private PG17
clusters. Sampled completion free space is **32.08 GiB**. The earlier 24.85 GiB
floor event and stopped-work recovery are disclosed above and in the aggregate.
Only recorded lane PIDs were signalled; `~/q24`, the shared port-55440 cluster,
repository configuration and remote refs were untouched. No push occurred.
Raw logs, controls, PID ledgers and remaining private databases stay outside Git
under `/tmp/stpf1-20261026/` and the named public-witness directories. The retained
million-message measurement fixture remains stopped under its original `/tmp`
path. Only aggregate evidence is committed. The later WF integration remains
separate work.
