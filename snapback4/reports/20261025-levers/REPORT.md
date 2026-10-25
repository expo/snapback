# LEV — mutation ingress and committer CPU on Postgres

2026-10-25 · expo-build-450b · local branch `sb4-pg/lev` · 32 clients.

Warm `/m` now carries a non-authorizing discovery hint and resolves final authority in the batch snapshot. It removes exactly one ingress Postgres flight per warm mutation. The CPU change retains each invocation's structurally validated closure for its first batch wave and avoids repeating that validation during speculative and final execution. Per-member argument validation, fresh authority, ordered conflict handling and fallback validation remain in place.

The native comparison below isolates the two levers. It is a fixed-rate latency/CPU comparison at **800 offered mutations/s**, not a new capacity search or a claim to beat the controls. Every repetition is retained. The CPU goal was toward 100 µs per committer member; the measured committer totals below determine how far this change gets.

Across the six cohort medians, ingress-only reduces whole-server CPU by 14.6–17.6%. Retaining plans then reduces it by a further 3.1–8.7%, with committer CPU down 9.5–19.6%. **The ~100 µs whole-committer target is not reached:** final disjoint/mixed paths use 116–128 µs/member, and exact shared W5 uses 212–221 µs/member. These results do not establish the ~100 µs assumption behind the G7.3-plus-levers forecast.

The incremental CPU lever improves five median latencies but regresses nominal 1% mix/B from **16.93 to 17.54 ms** (overlapping repetition ranges). Original W4/B's first repetition fails p99 at **189.006 ms**, with zero errors and an equal counter; it is retained and the cohort is unqualified under the three-repetition rule. This experiment does not identify that tail burst's cause or establish that either lever eliminates it.

## Changes and semantic evidence

- Ingress: `40e2a1ee45`, completed by `570ac0ded9`. `/q` and `/m` share bounded `operation_ingress` discovery hints. Hints bind store and supervisor revision. Cold credentials still resolve live facts. Fresh durable and detached/ephemeral checks refresh hints before a stale-kind refusal, so an unkeyed retry discovers the current kind. A hint cannot grant authority or authenticated response metadata.
- The new `rt3b_carried_mutation_batch_{sqlite,postgres}` witness warms the hint through a query, holds the writer, queues four real HTTP mutations, then changes revocation, expiry, scope, kind or principal generation. Each four-member batch refuses using fresh facts, emits no authenticated metadata and performs no write. Changed-kind retries resolve authority again. Existing RT3b/RT4 freshness witnesses and the ephemeral kind retry also pass. The supervisor-revision binding preserves immediate retired-worker refusal during SQLite retirement's writer lock.
- CPU: `13560f6574`. Classification retains each member's closure for the same immutable schema/program/intent; the first wave consumes it. Successful structural admission can then be reused while each member still canonicalizes and validates its arguments. Unsupported and physical fallback attempts discard the proof and validate fully. Closure selection copies only the arguments it needs. No limits, meter, protocol flight or durability settings change.
- `batch_plans_keep_per_member_arguments_{sqlite,postgres}` compares a wave run with serial execution across valid, malformed, missing and extra arguments. Full outcomes, meters and durable history agree, and the valid members demonstrably use waves. Existing overlay, fault and differential witnesses remain green.

The design record is [controls §3.3](../../../llp/3000.009.001.000.002-beating-the-postgres-controls.rfc.md#33-in-batch-concurrent-execution-under-the-head-lock); ingress/RT0 custody is [round-trip ledger §13](../../../llp/3000.009.001.000.001-the-request-round-trip-budget.rfc.md#13-g4a-read-refinement-2026-10-23). The [JOURNAL](../../JOURNAL.md) records the implementation and completed qualification.

## Method and provenance

Unmodified one-host runner methods and native S1-C generator, Postgres 16.15, native million-message `Engine::seed_at` image. The initial native seed took about 2,005 s; later arms restore a consistent dump of that completed image, verify equality and VACUUM before running. Restores reuse the stopped, owned canonical socket alias required by the deployment binding; no binding record is rewritten. Each arm starts a fresh private cluster and each cell a fresh service.

Pinning: Postgres `0–2,6–8`; app/proxy `3–4,9–10`; generator `5,11`. A adds 0.25 ms per direction, B adds 0.5 ms; before/after RTT and live per-thread affinity are recorded. G6 is unset: this is default G5. W4 uses disjoint counters; W5 uses exact shared counter and the existing nominal 1% hot mix. Every native cell uses 10 s warm-up, 20 s measured, three repetitions, the existing 100 ms write p99/error/counter rules and cap 32. No builds or qualification tests run during these native trials. Load checks retain the inherited rule that no unrelated process exceeds one core at cell start.

Native arms are original `4c6b386072`, ingress-only CLI `570ac0ded9` with the original core, and both levers `13560f6574`. The isolated ingress source manifest and all measured binary hashes are in the raw evidence; selected hashes are in [PROVENANCE.json](./PROVENANCE.json). The runner, harness and seed executable are unchanged. All measured programs are release builds with line tables only and the same SQLite compile flag. Own targets are `target/lev` and `target/lev-probe`. No fetch, push, stash or Git configuration change occurs.

Server CPU below sums every native app thread sampled at 100 ms, including HTTP, committer, interpreter workers and driver threads. Committer and wave-worker CPU are also shown separately. It excludes Postgres, proxy and generator CPU. Tick deltas cover warm-up + measurement + drain and divide by successful mutations over that same span; new threads use their first observed tick count. Thus short-lived work before the first sample is not captured. No root-PID-only sampler claim is made. Latency is the mean reconstructed using the pinned HDR histogram's median-equivalent bins, over measured arrivals including errors; it is not p50. Cohort entries are medians of three repetitions with min–max ranges where shown; these are repeatability ranges, not confidence intervals.

## Native server CPU

µs per successful mutation; each entry is **server / committer / wave workers**, medians of the three repetitions. Wave-worker CPU remains part of server CPU.

| Cell | Original | Ingress only | Ingress + CPU |
|---|---:|---:|---:|
| W4 disjoint / A | 514.2 / 154.6 / 108.8 | 438.3 / 152.9 / 110.4 | 411.7 / 125.0 / 110.8 |
| W4 disjoint / B | 510.4 / 143.8 / 104.6 | 420.8 / 142.5 / 104.6 | 407.9 / 118.3 / 106.7 |
| W5 same / A | 506.7 / 250.4 / 0.0 | 420.0 / 244.6 / 0.0 | 397.9 / 221.2 / 0.0 |
| W5 same / B | 486.2 / 237.9 / 0.0 | 414.6 / 238.8 / 0.0 | 383.8 / 212.1 / 0.0 |
| W5 hot1 / A | 527.1 / 155.8 / 110.4 | 447.9 / 154.6 / 108.8 | 409.2 / 127.5 / 111.2 |
| W5 hot1 / B | 499.2 / 143.3 / 102.9 | 426.2 / 144.6 / 102.9 | 396.2 / 116.2 / 105.4 |

Mean latency in ms, median (min–max) across three repetitions:

| Cell | Original | Ingress only | Ingress + CPU |
|---|---:|---:|---:|
| W4 disjoint / A | 16.02 (15.96–16.39) | 13.69 (12.92–13.81) | 13.26 (13.17–13.66) |
| W4 disjoint / B | 19.10 (18.57–23.82) | 16.61 (16.35–16.95) | 16.15 (16.12–16.22) |
| W5 same / A | 17.18 (16.63–17.27) | 16.14 (14.94–16.72) | 15.79 (14.86–16.21) |
| W5 same / B | 23.00 (22.74–24.17) | 21.10 (20.59–21.79) | 20.41 (20.09–21.10) |
| W5 hot1 / A | 15.33 (15.05–15.35) | 13.24 (13.12–13.28) | 12.90 (12.89–13.24) |
| W5 hot1 / B | 20.60 (20.06–20.63) | 16.93 (16.64–17.84) | 17.54 (16.94–18.08) |

Native SLO passes (all three are required for a passing cohort):

| Cell | Original | Ingress only | Ingress + CPU |
|---|---:|---:|---:|
| W4 disjoint / A | 3/3 | 3/3 | 3/3 |
| W4 disjoint / B | 2/3 | 3/3 | 3/3 |
| W5 same / A | 3/3 | 3/3 | 3/3 |
| W5 same / B | 3/3 | 3/3 | 3/3 |
| W5 hot1 / A | 3/3 | 3/3 | 3/3 |
| W5 hot1 / B | 3/3 | 3/3 | 3/3 |

The ingress effect is original → ingress-only; the incremental CPU effect is ingress-only → both. Server CPU repeatability ranges, p99, errors and counter pass counts are in [AGGREGATES.json](./AGGREGATES.json). No overlapping CPU category is counted twice. Fixed arm order is disclosed; three repetitions do not establish that a lever eliminates sporadic startup/tail bursts. A failing native cohort is still shown, but is not a qualified capacity result.

## Flights and batch fill

Warm ingress falls **1 → 0 → 0** Postgres flights per mutation. The batch protocol remains four flights for a simple G5 wave and five for a dependent shared-counter wave. Ingress runs on HTTP threads and is outside the batch; no N × ingress RTT is added to a serial cycle.

The native statement census independently identifies grouped authority members, batch counts and dependency levels. The following is **original → ingress-only → both**. `batch F/member = (4 × batches + extra dependency levels) / grouped members`; the final column adds the warm ingress flight. This census covers the grouped route, with its actual member coverage stated below; it does not mislabel SQL statements as protocol flights or claim an exact all-traffic count including cold discovery, singletons and background work.

| Cell | Mean N | Batch flights/member | Warm ingress + batch flights/member |
|---|---:|---:|---:|
| W4 disjoint / A | 7.95 → 7.61 → 7.35 | 0.503 → 0.525 → 0.545 | 1.503 → 0.525 → 0.545 |
| W4 disjoint / B | 9.54 → 9.22 → 9.08 | 0.419 → 0.434 → 0.440 | 1.419 → 0.434 → 0.440 |
| W5 same / A | 8.50 → 8.90 → 8.51 | 0.588 → 0.562 → 0.588 | 1.588 → 0.562 → 0.588 |
| W5 same / B | 11.47 → 11.57 → 11.34 | 0.436 → 0.432 → 0.441 | 1.436 → 0.432 → 0.441 |
| W5 hot1 / A | 7.54 → 7.24 → 7.17 | 0.540 → 0.563 → 0.568 | 1.540 → 0.563 → 0.568 |
| W5 hot1 / B | 10.15 → 9.32 → 9.65 | 0.404 → 0.439 → 0.424 | 1.404 → 0.439 → 0.424 |

Grouped-member coverage across native repetitions: baseline 99.992–99.996%, ingress 99.996–99.996%, cpu 99.992–99.996%.

A changed mean N changes amortized flights/member without a protocol change. Both HTTP and engine RT0 ratchets pass. Seven HTTP mutation classes each fall by one Postgres flight and one SQLite statement: account/unkeyed 7→6 / 22→21, keyed-first 8→7 / 30→29, one-membership 8→7 / 23→22, replay 2→1 / 5→4, unknown-op and narrowed 2→1 / 4→3. Query and direct engine-batch rows remain unchanged; cold/unknown credentials retain live discovery.

## CPU attribution

Separate out-of-tree release probes use `CLOCK_THREAD_CPUTIME_ID` with nested exclusive/inclusive spans and gprofng sampling (`perf` is denied). They run W4/B and exact W5/B with 2 s warm-up, 8 s measured and three repetitions after qualification has stopped. Before is the original binary; after includes both levers. The native ingress-only arm above isolates the CPU lever. The clocks change neither production code nor the measured native binaries; no overhead is subtracted.

Each snapshot is matched to the nearest resource-window boundary. Numbers below are CPU µs per physical attempt member, pooled over three repetitions, **exclusive** of nested spans. Interpreter CPU runs on wave workers for disjoint W4 and on the committer for ordered shared-counter reruns. The batch-attempt inclusive total is shown separately; it excludes outer classification/binding/finish and excludes CPU consumed concurrently on workers, so it must not be called whole-committer CPU or added to its nested stages.

| CPU component | W4 before | W4 after | W5 exact before | W5 exact after |
|---|---:|---:|---:|---:|
| Facts/plan setup | 19.56 | 5.66 | 21.16 | 8.04 |
| Facts decode | 9.85 | 5.17 | 10.51 | 6.15 |
| Interpreter | 98.34 | 96.45 | 107.44 | 104.95 |
| Ordered member handling | 33.89 | 28.07 | 47.90 | 37.77 |
| Conflict/take | 1.30 | 1.38 | 1.18 | 1.16 |
| Overlay apply setup | 0.21 | 0.24 | 0.15 | 0.15 |
| Tail assembly | 1.89 | 2.00 | 1.12 | 1.12 |
| Tail encoding | 2.76 | 3.13 | 1.95 | 1.84 |
| Fact encoding | 0.56 | 0.55 | 1.65 | 1.79 |
| Literal encoding | 4.96 | 5.32 | 4.99 | 5.26 |
| Driver result decode | 6.34 | 6.95 | 6.63 | 7.08 |
| Driver | 23.18 | 26.46 | 26.46 | 27.76 |
| HTTP | 168.47 | 129.97 | 166.41 | 127.64 |
| Batch attempt (inclusive) | 118.06 | 98.40 | 235.41 | 212.16 |

Ordered member handling includes final validation and accepted-overlay updates. The tiny apply-setup span is only the hand-off to deferred durable application; it is not all overlay CPU. Facts-decode and HTTP changes include the ingress lever, so they are not attributed entirely to plan reuse.

The aligned probe flight counters independently give:

| Probe | Mean N | Batch flights/attempt member | HTTP ingress flights/attempt member |
|---|---:|---:|---:|
| profile-before-clean W4 disjoint / B | 10.30 | 0.389 | 1.000 |
| profile-before-clean W5 same / B | 11.70 | 0.428 | 1.000 |
| profile-after-clean W4 disjoint / B | 9.49 | 0.422 | 0.001 |
| profile-after-clean W5 same / B | 11.19 | 0.447 | 0.001 |

Maximum boundary matching error is 0.494 s. The baseline short probe passes 5/6 SLO repetitions (its first W4 repetition has p99 214.565 ms and two HTTP 503s); the after probe passes 6/6. All repetitions contribute to attribution, including that failure. Probe latency is not the native performance comparison.

gprofng identifies repeated admission/closure analysis as avoidable work; the retained-plan change removes that repetition. Facts clone/codec costs did not justify a representation rewrite. The raw profiles preserve symbol tables, actual binary hashes and numeric phase/flight counters. Initial exploratory profiles overlapped qualification disk I/O and are retained only as diagnostics; their latency is excluded from this comparison. Failed restore attempts (missing explicit schema, then endpoint-binding mismatch) are also retained. They were repaired by schema creation and reuse of the original owned alias, without bypassing store identity.

## Qualification and custody

- Full core: **1275 passed / 0 failed / 440 ignored** (final Cargo target summaries; isolated child summaries are excluded).
- Full CLI binary: **609 passed / 0 failed / 58 ignored** (final Cargo target summaries; isolated child summaries are excluded).
- Full Postgres script: **810 passed / 1 failed / 0 ignored** (final Cargo target summaries; isolated child summaries are excluded).
- The only final Postgres red is the inherited evaluator concurrent read/modify/write stress `40001` (`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`). It remains a failed qualification, not a converted pass. All later stages run, including RT0, RT3b/RT4, batch/overlay/fault, differential corpus and public Postgres serving. The TCP-only wire witnesses use a separately declared private TCP cluster. An earlier socket-only run's two wire failures were fixture errors and pass with that TCP fixture.
- Both RT0 ratchets: pass, with the ingress counts updated as above. The SQLite ratchet also ran explicitly; Postgres runs within the full script. Full binary includes the SQLite authority witnesses; Postgres script includes their Postgres counterparts.
- Native runner audit: **54 trials, 18 cohorts; 53 passing trials; 54 counter-equality passes**. All histogram, schedule, error accounting and per-repetition SLO rules are independently re-audited.
- `./ref-check`: see final evidence receipt below. Earlier development failures (missing debug CLI and the subsequently fixed supervisor-fence hint regression) remain in the external raw logs; the final suites are the results above.

The final evidence receipts below cover RTT/load/disk/affinity, archive and PID custody. Raw per-trial data, tokens, passwords and database images are not committed. Aggregate JSON is committed; sanitized raw evidence remains outside Git as an archive with SHA-256. No push.

## Final evidence receipts

RTT ranges over all before/after cell captures: A p50 **0.562–0.573 ms**, p99 **0.575–0.645 ms**; B p50 **1.071–1.100 ms**, p99 **1.108–1.153 ms**. All 18 cell-start load checks pass on their first observation; maximum recorded unrelated use is **0.138 cores**. One-minute load averages span **1.38–2.85**. All app/PG thread-affinity witnesses and generator starts pass. The continuous custody monitor records a minimum of **37.263 GiB** free, above both the 25 GiB stop rule and the runner's 30 GiB guard. [QUALIFICATION.json](./QUALIFICATION.json) preserves the aggregate receipts.

`./ref-check`: **569 LLP documents, 11,972 references in 45,000 files; 0 errors, 0 unchecked**. The only new annotation after the earlier core/CLI qualification is explanatory; no measured code changes after `13560f6574`.

Secret audit: **259 known values, zero hits** in staged content or included archive files. Private fixture/database state and external source symlinks are excluded; the archive contains 11,280 included evidence files plus the two audit control receipts. Aggregate profile counters are in [PHASES.json](./PHASES.json).

Sanitized external archive: [lev-20261025-evidence.tar.gz](/home/ccheever/sb4scale/lev-20261025-evidence.tar.gz), 938,301,278 bytes. SHA-256: `fba22a46e465f310b267ed6e42d5edfe7e57efd75c4ec51c45842c8e62007687`. The archive includes frozen continuous custody logs; [QUALIFICATION.json](./QUALIFICATION.json) adds the final post-archive receipt.

Final independent process census checks **6,522 PID/birth identities**, with zero unkeyed records, **no live task process and no zombies**. Every native/probe runner reports clean shutdown; public/evaluator/TCP clusters independently confirm stop, and the custody monitor has exited. Persistent Codex/tool infrastructure is outside the task-process scope. **PIDs left: none.**

## LEV fix round 1: authority hint audit

This correctness-only round starts at `2c64741a39` on `sb4-pg/lev-fix1`.
It runs no throughput measurements and does not extend the earlier performance
qualification to the corrected code. Raw test output remains under `/tmp`,
outside Git. The governing context is LLP 3000 §4 (the Snapback 4 fence),
LLP 3000.009.001.000.001 §3.1/§13 (fresh authority and non-authorizing hints),
and LLP 3000.009.001.000.002 §3.3 (attempt-local plans and full fallback).
No new design mechanism or authority cache is introduced.

The durable callback now checks the fresh store id and generation before
refreshing hints or comparing capabilities. Hint insertion uses the resolved
observation's supervisor revision and binding, discarding it if the host has
changed. Custom/action kinds remove an older ordinary entry. Ephemeral and
durable final checks share that eviction rule. Generation joins store id in
the bounded hint's binding; a supervisor fence is sampled under the hint-map
lock for lookup. Cold discovery retains its original clock sample after
reader checkout; a revision change anywhere across discovery discards the
insert rather than relabeling the observation. The full binary is rerun after
this timing-preserving refinement.

Failing-before controls:

| Review item | Witness and negative control |
| --- | --- |
| Serving-store identity | `rt3b_lev_store_binding_*`: warm the hint at A, use `test_request_store_id` to change only durable identity to B, then repeat unkeyed `/m` without `store_id`. The SQLite witness fails on `2c64741a39` because the mutation succeeds. Corrected requests refuse `E_STORE_REPLACED` without metadata or writes. |
| Non-cacheable kind | `rt3b_lev_custom_{durable,ephemeral}_*`: ordinary → `customer`, one stale-kind refusal, then three unkeyed retries. Both SQLite witnesses fail on the original tip because retries remain stale; corrected retries succeed through complete discovery and leave no hint. |
| Supervisor observation | `rt3b_lev_retired_observation_*`: resolve at R, advance the fence, then attempt insertion with the R observation. Hold the writer while an unkeyed request must immediately refuse `E_AUTH`. Original SQLite code times out behind the writer. |
| Durable retry coverage | `rt3b_carried_mutation_batch_*` now retries with args only. Disabling only durable final hint refresh makes the SQLite test fail on that retry. |
| Plan reuse coverage | `batch_plans_keep_per_member_arguments_*` also counts `Closure::new` calls on the invoking thread. Restoring the five production plan files from `13560f6574^` (and its private test-call signature), preserving the counter and witness, fails at runtime: **14 calls versus 7 required**. The fixed code passes with 7. |

The invalidation audit follows every hint producer and consumer and the shared
resolver. “Fresh check” below means the hint is bypassed as an authority source;
it need not be eagerly removed to refuse safely. Witness names ending in `*`
have SQLite and private-Postgres variants.

| Change | Required behavior and covering witness |
| --- | --- |
| Session revocation / token replacement | Fresh batch or detached authority sees no live credential. `rt3b_carried_mutation_batch_*` (`revoke`), `rt3b_authority_boundaries_*` (upload/queue/replay), and `rt3b_carried_query_*`. |
| Expiry / read-cap expiry | Fresh service-clock sample at each final attempt; the shared resolver applies expiry and cap boundaries. `rt3b_carried_mutation_batch_*` (`expiry` at exact expiry), `rt3b_authority_boundaries_*`, and the authority-facts equivalence matrix (both read scopes and cap edges). |
| Scope | Fresh comparison refuses a Full → Read transition before writes or metadata; an ordinary hint may refresh but grants nothing. `rt3b_carried_mutation_batch_*` (`scope`), `rt3b_fix_ephemeral_*scope_*`. |
| Kind / action claim | Ordinary changes refresh; non-cacheable changes evict and take complete discovery, including action-claim policy. `rt3b_carried_mutation_batch_*` (`kind`, unkeyed retry), `rt3b_fix_ephemeral_kind_*`, `rt3b_lev_custom_{durable,ephemeral}_*`, and authority-facts action/custom equivalence cases. |
| Principal generation | Public principal revocation deletes full sessions. Read credentials additionally compare their recorded generation to the fresh principal generation. `rt3b_carried_mutation_batch_*` covers both public revocation (`generation`) and generation-only invalidation (`read-generation`); the latter fixture proves the session rows remain present. Full sessions are not independently generation-bound by existing policy. |
| Supervisor retirement | A changed fence misses the hint; insertion cannot relabel an older observation. `rt3b_lev_retired_observation_*`, plus `rt3b_authority_boundaries_*` (`supervisor`) and the supervised retirement/writer-lock witnesses. |
| Store id | Lookup misses a changed serving id; the final boundary also compares the fresh durable id even when `Shared.wake` is unchanged and the body omits `store_id`. `rt3b_lev_store_binding_*`, `rt3b_fix_ingress_store_mismatch_*`. |
| Store generation / code activation | A generation change misses the hint; existing transaction/opening identity guards and the batch facts check refuse stale engines. `rt3b_generation_bearer_unkeyed_*` and `rt3b_generation_bearer_keyed_*` now explicitly warm a hint before foreign adoption; `rt3b_metadata_refusal_uses_its_snapshot_program_*` and ephemeral-conversion witnesses cover local adoption. |
| Ownership loss | Queue admission and durable owner fencing remain mandatory regardless of the hint; unfenced historical replay stays available. `rt3b_lev_ownership_*` repeats warm unkeyed attempts after queue or durable owner loss; `rt3b_replay_and_concurrent_copies_*` covers keyed/replay semantics. |

Final qualification (passed / failed / ignored, Cargo target summaries):

| Check | Passed | Failed | Ignored |
| --- | ---: | ---: | ---: |
| Full core | 1,275 | 0 | 440 |
| Full binary, after preserving clock sample points | 614 | 0 | 63 |
| Explicit SQLite HTTP RT0 filter | 1 | 0 | 0 |
| Postgres HTTP RT0 filter | 7 | 0 | 0 |
| Core overlay RT0, both stores | 2 | 0 | 0 |
| Complete `bash scripts/test-postgres.sh`, Rust targets | 820 | 1 | 0 |
| Final focused PG16 clock/hint checks | 21 | 0 | 0 |

Passing isolated child invocations are excluded from those target totals:
core 1, binary 13, Postgres script 1. The full Postgres script remains **failed**
solely on the inherited
`evaluator_concurrent_read_modify_write_and_duplicate_ops_are_atomic_in_both_modes`
SQLSTATE **40001**, “could not serialize access due to concurrent update”.
Every later stage completes, including the 76 RT3b checks, both argument/reuse
witnesses, core/HTTP RT0, corpus, differential tests and public serving.
The final focused recheck passes 10 ephemeral, 10 hint and 1 lock-gap tests
on the final source. The two RT0 expectation files remain unchanged.

`./ref-check`: **569 LLP documents, 11,974 references in 45,003 files;
0 errors, 0 unchecked**. `git diff --check` also passes. No throughput
benchmarks were run; raw logs remain outside Git. Builds use this worktree's own
target, line-tables-only debug information and four Cargo jobs. The continuous
40 GiB guard never fires; Cargo cleans this target's old release, simulator
and core artifacts to preserve the disk margin, rebuilding required artifacts.

All three private PG16 masters are stopped and independently absent:
**2885596** (main evaluation, port 57597), **2972890** (public witness,
private socket), and **3005185** (final focused recheck, port 54915).
Each has `pg_ctl status=3` and no `postmaster.pid`; the public witness's
531 recorded child/command PIDs are also independently absent. The final
combined census of 582 recorded PIDs contains no living task process. Data and raw
receipts remain outside Git. **Task-owned PIDs left: none.** No push occurs.
