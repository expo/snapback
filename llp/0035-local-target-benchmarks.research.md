# LLP 0035: Local-target benchmarks

**Type:** Research
**Status:** Draft
**Systems:** Runtime, Storage, Realtime, Sync, Ephemeral state, Testing, Performance
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-07-21 (superseded-fixtures note: the `37f1a2f` benchmark
corrections invalidate all pre-correction fan-out figures pending a full-scale
rerun — LLP 0067 Recommendation 1). 2026-07-13 (§Current measurement contract — finite-query DK-4 probe, protected-live fan-out interpretation, and synchronized L6 A/B; 2026-07-02: §Idle cost, §M3, §After warm VM, §L6+L7)
**Related:** LLP 0000, LLP 0003, LLP 0008, LLP 0009, LLP 0012, LLP 0022, LLP 0032

## Summary

This is the artifact of [LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
**M1**: the in-repo benchmark harness (`crates/snapback/src/bench.rs`, run by the
`snapback-bench` bin) and its first numbers over the canonical local target
(Ibex + in-memory SQLite). It turns the corpus's named unknowns into measured
numbers so the deferred decisions can be made on evidence rather than intuition.

**The headline: a fresh VM per invocation dominates everything.** Handler
invocation costs **~3.9 ms** (VM create + host install + eval, with no data
work), which caps single-writer throughput at ~230 mutations/s and — because
each affected live subscription re-runs a *fresh-VM* query on every commit —
caps live fan-out at roughly **2 affected subscribers per commit within a 10 ms
budget**. Everything else is cheap: the matcher is ~1.8 µs/subscription, read-set
validation ~1.3 µs/dependency, and ephemeral publish ~2 µs (≈485k/s). The
table-granularity spurious-conflict rate is **1.0** (every disjoint-row
concurrent writer to a queried table conflicts). These point sharply at DK-4
(warm VM), DK-3 (op-log deltas / cacheable read lane), and E4
(predicate-granularity validation).

## Method

- **In-process, no HTTP.** The harness drives `LocalSnapback`/`LocalDatabase`
  directly so numbers isolate compute, not transport. Timing is
  `std::time::Instant`; each compute metric warms up (the first Ibex eval pays
  one-time costs) then times N iterations and reports the per-iteration mean.
- **Real engine.** Handlers are real Ibex modules executed through the embedded
  `ctx.db` bridge (the harness needs `DYLD_FRAMEWORK_PATH` set, like the tests),
  so the VM cost is the real Hermes create/install/eval, not a stub.
- **Schema.** Two tables (`todos`, `others`) so "affected" vs "not affected"
  fan-out can be separated by mutating a table the subscriptions do not watch.
- **Derived numbers** are labelled as such (single-writer throughput = 1/mutation
  cost; fan-out ceiling = 10 ms ÷ per-affected-subscription cost).
- **Honesty about precision.** These are a **single run on one developer machine
  (Apple Silicon, `--release`)**, reported to **order of magnitude**, not a
  statistically controlled benchmark. The *shape* (VM cost dominates; fan-out is
  VM-bound; matcher/validation/ephemeral are cheap) is robust; the exact digits
  will vary by machine and run. CI runs a tiny-scale smoke variant
  (`m1_bench_smoke`) with 10× threshold headroom to catch order-of-magnitude
  regressions without flaking on shared-runner noise.

## Current measurement contract (2026-07-13, protected-query enforcement)

> **Superseded fixtures (recorded 2026-07-21).** Commit `37f1a2f`
> (ENG-23422/ENG-23423, 2026-07-07) corrected both fan-out fixtures as
> methodologically unsound: the delta loop had made only one subscriber match
> and divided by the total count (the corrected harness comment: mixing the
> non-member reject path "would understate the affected delivery cost and
> overstate the derived fan-out ceiling"), and the fallback fixture grew its
> result set per subscriber instead of holding it fixed (now
> `FANOUT_RESULT_ROWS = 16`). Every pre-correction figure in the tables below
> — ~1 550–2 000 and ~1 680–1 970 µs/sub, ~0.32–0.36 µs/sub, ~5 200×, ~5–6
> and ~28 000–31 000 subs/commit — is therefore a **superseded fixture
> result, preserved as history only**. No corrected full-scale rerun is
> recorded; the CI smoke gate asserts only that the delta path stays ≥2×
> cheaper than the protected re-query path per run. Do not cite the old
> ceilings or the ~5 200× ratio as current evidence (LLP 0067
> Recommendation 1).

The dated result tables below remain the evidence produced by the runtime that
existed on 2026-07-01 and 2026-07-02. The common auth invocation gate later made
every auth-scoped `LiveQuery` use the protected fresh-realm profile. That exposed
two stale benchmark assumptions and one timing approximation; the harness now
uses these contracts:

- **DK-4 warm/fresh is an ordinary finite query.** `noop` had accidentally been
  registered as a `LiveQuery` by the benchmark's shared query constructor. Once
  protected-query enforcement landed, both `vm_cost_us` and `warm_invoke_us`
  therefore took the intentionally fresh path, so their ratio no longer tested
  pooling. `noop` is now a non-retainable `Query`: the fresh measurement disables
  pooling and the warm measurement leaves it enabled, while handler source and
  input stay identical. This is the DK-4 eligible profile. The harness does not
  weaken the protected profile or falsely mark a live query authority-independent
  to recover a favorable number.
- **Live fan-out is now a protected fresh-realm re-query.** `listTodos` remains
  an auth-scoped `LiveQuery`, so current `fanout_us_per_affected_sub` and the
  read-lane controls intentionally pay a fresh realm. The 2026-07-02 warm-fan-out
  numbers describe that dated build, not the current execution profile. The
  delta smoke comparison remains meaningful: it compares the shipped delta path
  with the actual protected re-query path measured in the same run.
- **The L6 A/B is causally synchronized, not clock calibrated.** A writer takes
  the instance mutex and acknowledges acquisition over a rendezvous channel. A
  global-mutex reader then starts its timer and signals that it is about to
  attempt the lock. While the writer remains held, four read-lane control
  queries complete; the writer is then released to commit and the queued
  reader finishes. The queued timer necessarily encloses the control work,
  while the lane metric is that work's per-query mean. This proves queueing
  versus progress without sleeps, a
  host-calibrated spin count, or an absolute millisecond floor. Its numeric
  values are not directly comparable to the old constructed 400 ms window. A
  generous 30-second receive timeout exists only to turn a lock-topology
  regression into a failure instead of a wedged test; it does not size the
  writer hold or participate in the reported metric.

This correction changes the measurement contract and interpretation; it does
not claim a new full-scale release result.

Reproduce:

```
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \
  cargo run --release --bin snapback-bench        # labelled summary
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks \
  cargo run --release --bin snapback-bench -- --json   # machine-readable
```

## Results (2026-07-01, one machine, release)

| Metric | Number | What it measures |
| --- | --- | --- |
| Per-invocation VM cost | **~2 700–3 900 µs** | create + eval of a trivial handler touching no data (varies run-to-run on a dev machine) |
| — of which VM *creation* | **~55 %** | `ex_hermes_create` + wiring + drop (host install cached) — what a warm VM avoids; the rest is eval |
| Single-writer throughput | **~227 mut/s** | sequential `createTodo` commits under the global instance mutex (the single-writer breaking point) |
| Matcher cost (skip path) | **~1.8 µs/sub** | per-subscription cost to evaluate and skip an *unaffected* subscription |
| Live fan-out cost (affected) | **~4 900 µs/sub** | per *affected* subscription: re-run the query (a full VM invocation) + serialize + enqueue |
| Fan-out ceiling @ 10 ms | **~2 affected subs/commit** | 10 ms ÷ per-affected-sub cost |
| Read-set validation cost | **~1.3 µs/dep** | per row dependency validated at commit |
| Spurious-conflict rate (non-matching) | **1.0 → 0.0** | fraction of concurrent writers that don't match a *filtered* query's predicate yet conflict a reader of it: **1.0** under table-granularity validation, **0.0** after E4's predicate-granularity validation landed (same day) |
| Ephemeral publish | **~485 000 pub/s (~2 µs)** | per-publish cost with a handful of subscribers (the 20–60 Hz cursor target has ~4 orders of magnitude of headroom) |

## L6+L7 re-run (2026-07-02, after the concurrency arc landed)

The harness then gained a `read_during_write` A/B (file-backed database; a busy
mutation held the write lane for a constructed 400 ms while one read ran each
way, both paths measured in the same build) and was re-run at full scale after
the reader-pool/offload arc
([LLP 0032](./0032-decision-and-implementation-hardening.plan.md) L6+L7) landed.
Two runs, same machine and method as above.

| Metric | Before (design) | After (measured) | Meaning |
| --- | --- | --- | --- |
| Read during a busy write — global mutex | *the write's remaining duration by construction* | **~302 000–309 000 µs** | the pre-L6 path, still measurable: the read queues behind the busy write |
| Read during a busy write — read lane | *n/a (lane did not exist)* | **~4 300–4 600 µs** | ≈ one fresh-VM query invocation — zero queueing (**~70×** better) |
| Single-writer throughput | ~227 mut/s | **248–278 mut/s** | no regression from `lock_owned` + `spawn_blocking` on the write path (within run variance) |
| Per-invocation VM cost | ~2 700–3 900 µs | ~3 600–4 400 µs | unchanged shape; run-to-run variance as documented above |

The read-lane number **is** the VM cost: with queueing eliminated, a
read-during-write costs exactly what a standalone read costs, which reconnects
this table to the DK-4 conclusion — the next read-latency lever is VM reuse,
not concurrency. The mutex-path number is kept measurable on purpose (the
harness reads through the global lock) so future regressions in either lane
stay visible. The CI smoke lane asserts the split (lane read under half the
busy window; mutex read over a quarter of it). That timing protocol has since
been replaced by the causally synchronized contract above; the table remains a
historical L6+L7 result.

## After warm VM (2026-07-02, DK-4 landed)

The DK-4 warm-VM pool landed the same day
([LLP 0009](./0009-code-execution-security.rfc.md) §DK-4 as-built: VM reuse
per module source for queries/mutations behind a verified per-invocation
reset; actions and hosted stay fresh). The harness gained a `warm_invoke_us`
metric — the warm-path cost of the same trivial no-data query — while
`vm_cost_us` **keeps its fresh-create definition** (the measurement disables
the pool) so the fresh baseline stays visible. Numbers below are the
representative of **two full-scale release runs**: the initial landing and a
re-run after the adversarial-review hardening (the invocation-epoch
stale-continuation guard, the broadened reset root-set, the pool generation
counter). The guard added **no measurable warm-path cost** — the `noop`
warm-invoke metric makes zero host calls, so the epoch check does not even
execute on it, and the per-invocation `host`/builder closure rebuild is in the
noise (warm invocation ~800–900 µs across both runs).

| Metric | Before (L6+L7 re-run) | After (warm VM) | Meaning |
| --- | --- | --- | --- |
| Per-invocation VM cost (fresh) | ~3 600–4 400 µs | ~3 600 µs (one run spiked ~5 500) | definition unchanged (pool disabled in the measurement); dev-machine run-to-run variance — the same-run fresh:warm ratio is the honest comparison |
| Warm-path invocation | *n/a* | **~800–900 µs** | invoke-IIFE eval + reset sweep, no create, no module re-parse — **4.5–6.1×** cheaper than fresh in the same run |
| Single-writer throughput | 248–278 mut/s | **~1 050–1 280 mut/s** | ~4–5× — the commit itself is now visible beside the VM work |
| Live fan-out cost (affected) | ~4 900 µs/sub | **~1 550–2 000 µs/sub** | ~2.4–3× — the fresh-VM component is gone; what remains is the re-query row work + serialize + dependency capture, which is DK-3 (op-log delta) territory |
| Fan-out ceiling @ 10 ms | ~2 affected subs/commit | **~5–6 affected subs/commit** | derived |
| Read during a busy write — read lane | ~4 300–4 600 µs | ~6 000–7 200 µs | **a warm-pool miss by construction**: the harness's single warm VM is checked out by the busy writer (same bundle), so the one concurrent read pays a fresh create+setup — ≈ the fresh path, never queued. Steady-state concurrent readers warm their own VMs (the pool holds up to 4) |
| Read during a busy write — global mutex | ~302 000–309 000 µs | ~300 000 µs | unchanged by design (still queues; kept measurable) |

**Current-contract note (2026-07-13):** the live-query fan-out and read-lane
interpretations in this dated table predate protected-query enforcement.
`listTodos` is now intentionally fresh-realm because it is an auth-scoped
`LiveQuery`; a current lane read is not a warm-pool miss caused by contention.
The synchronized A/B described above supersedes the constructed 400 ms window.

Reading the numbers:

1. **The warm path delivers the projected win where it was projected.** The
   two write-lane ceilings the M1 numbers blamed on VM creation both moved:
   single-writer ~4–5×, fan-out ~2.4–3×. The ~800–900 µs warm invocation is the
   new floor for one handler run — roughly: parse+eval of the small invoke
   IIFE, the handler's own work, and the reset sweep (globalThis + dispatch
   table + the broadened intrinsic root set, a few hundred descriptor
   comparisons). The stale-continuation guard's per-host-call epoch check
   (string split + `u64` parse + compare) is dwarfed by the JSON round-trip it
   sits beside and did not move the metric.
2. **Fan-out is no longer VM-bound; it is row-bound.** At ~2 ms per affected
   subscriber the remaining cost is re-running the query against a growing
   result set and re-serializing all rows — exactly the whole-document
   `replace` shape DK-3 pinned for v1. This is the measured hand-off from
   DK-4 to the DK-3 revisit trigger (op-log deltas), not a residual VM
   problem.
3. **The read-lane A/B still shows queue elimination** (~300 ms mutex vs
   ~7 ms lane, ~42×), and the lane's single-read cost honestly shows the
   pool-miss case rather than an idealized warm hit.
4. The `m1_bench_smoke` CI lane now asserts `warm_invoke_us <
   0.75 × vm_cost_us` — it fails if the warm path silently regresses toward
   fresh (e.g. a broken reset burning every VM, or a silent fallback);
   measured warm:fresh ratio **~0.16–0.22** across the two runs.

## M3 — the DK-3 op-log-delta projection (2026-07-02, warm VM landed)

DK-3's revisit trigger ([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md)
§Decision DK-3) names the condition for building op-log deltas: *"warm-VM
fan-out still exceeds the target latency at a real subscriber count — re-measure
with M1 after DK-4 lands."* This is that re-measurement. The harness gained a
`fanout_delta_us_per_affected_sub` metric: the projected cost of the op-log-delta
path for the analyzable subset (single-table filtered live query), which
classifies each committed `ChangedRow` against the subscription's captured
predicate with the **real live matcher** (`row_matches_query_filters`) and
serializes a small delta — no VM, no re-query — instead of re-running the whole
query. It is a projection (labelled as such), but it runs the real matcher and
serializer, so it is a faithful lower bound on the server-side delta cost, not a
stub. Two full-scale release runs:

| Metric | Warm re-query (shipped) | Op-log delta (projected) | Ratio |
| --- | --- | --- | --- |
| Fan-out cost per affected subscription | **~1 680–1 970 µs** | **~0.32–0.36 µs** | **~5 200–5 500×** |
| Fan-out ceiling @ 10 ms budget | **~5–6 subs/commit** | **~28 000–31 000 subs/commit** | — |

**The trigger is armed, decisively.** Even after warm VM removed the VM-creation
cost, whole-query re-query-per-affected-subscriber caps live fan-out at ~5–6
subscribers per commit within a 10 ms budget — so a query with 100 watchers
costs ~170–200 ms of fan-out per commit, and a popular feed/leaderboard (the
read-heavy reference apps LLP 0000 names) is far past the budget. The op-log
delta collapses the per-affected-subscriber cost by ~5 200× because it is
matcher-and-serialize work (the matcher is ~2 700× cheaper than a VM re-query —
the M1 result that first flagged this), moving the ceiling from single digits to
tens of thousands of subscribers per commit. This confirms op-log deltas as the
**next fan-out lever after DK-4**, exactly as DK-3 sequenced them.

Honest scope of the projection:

- It measures the **unordered single-table-filter** case (the common syncable-live
  subset). Ordered/limited queries carry extra boundary work when a change shifts
  the top-N window; the matcher already has those primitives
  (`matching_limited_row_may_affect_query`, `query_boundary`), so the delta path
  extends to them, but at a higher (still VM-free) per-change cost not measured
  here.
- It is the **server compute** cost. It does not include the wire-format change or
  the client-side delta apply — those are the Phase-2 implementation, which
  touches the shared delivery/wire surface the LLP 0034 kit thread also owns and
  must be sequenced with it, not the isolated server measurement this is.
- The `~0.32 µs` is per affected subscriber for a one-row commit; a commit
  changing K rows scales the classify by K, still far below a single VM re-query.

The CI smoke lane asserts `fanout_delta_us_per_affected_sub × 2 <
fanout_us_per_affected_sub` (both measured the same run, machine-independent) —
it fails if op-log deltas ever stop decisively beating the actual re-query path,
which is the whole premise of the lever. The table above is the 2026-07-02 warm
re-query result; current smoke runs exercise the protected fresh-realm live
query described in §Current measurement contract.

**Landed 2026-07-02.** The projection became the shipped path: live delivery
emits an additive `live_delta` for the analyzable HostPlan subset instead of a
whole-result `live_replace` (`notify_live_subscriptions` + `compute_live_delta`;
client apply in `demos/_kit/client.mjs`; LLP 0008 §Decision DK-3, resolving
LLP 0034 OQ1). The bench measures the same `compute_live_delta` the fan-out
calls, so `fanout_delta_us_per_affected_sub` is now the cost of shipped code,
not a projection.
## Idle cost (2026-07-02, LLP 0032 X5)

The scale-to-zero claim, measured on the canonical local target. **Method:**
release build; `snapback start` with a file-backed database; the todo demo's
schema + function manifests loaded through the gated system routes; then the
instance left completely idle — zero connections, zero subscriptions, no
armed cron (todo declares no jobs) — for **120 seconds**, sampling process
CPU time (`ps -o cputime`), resident memory (`ps -o rss`), and the
size/mtime of the database and WAL files at the start and end of the window.
Measured on the pre-origin-sync Phase 5 line
(`backup/main-before-origin-sync-20260702`).

| Measure | Start | After 120 s idle |
| --- | --- | --- |
| Process CPU time | 0:00.02 | **0:00.02** (no measurable change) |
| Database file | 4 096 B, mtime frozen | **byte-identical, mtime unchanged** |
| WAL file | 86 552 B, mtime frozen | **byte-identical, mtime unchanged** |
| Resident memory | 13 472 KB | 13 488 KB (~13.2 MiB) |

**Reading:** an idle provisioned instance performs **zero disk writes** and
consumes **no measurable CPU** (sub-centisecond over two minutes — below
`ps` cputime resolution); its footprint is ~13 MiB resident. The periodic
machinery that exists — the 1 s cron ticker behind the lock-free
`cron_active` check (L5), the 30 s connection reaper (L2), the maintenance
worker (L3), and the 30 s WS heartbeat (L8) — is visible in these numbers
as *nothing*, which is the point: idle means idle. Caveat: this measures
the always-on local process; per LLP 0000 §Multi-target deployment, idle
*cost in dollars* is target-dependent (an always-on VM bills its base rate
regardless), so each target profile records its own idle expectations —
this section is the local target's entry.

## What the numbers mean

1. **The VM is the whole cost.** A fresh VM per invocation is ~3 orders of
   magnitude more expensive than the matcher, validation, or an ephemeral
   publish. Single-writer throughput is just `1 / VM-cost`; the commit itself is
   in the noise. **Anything that reduces per-invocation VM cost is the single
   biggest lever in the system.** The decomposition (M2) attributes **~55 % to
   `ex_hermes_create`** (pure VM creation) and ~45 % to eval — and caching the
   per-invocation host install moved the total within run-to-run noise, so the
   install was *not* the cost. The lever is therefore **VM reuse** (a warm VM
   avoids creation entirely and re-parsing the module inside eval), not the
   host-install cleanup. This is the concrete backing for DK-4.

2. **Live fan-out is catastrophically VM-bound.** Each affected subscription
   costs ~4.9 ms because the current design **re-runs the subscription's query
   in a fresh VM on every commit** (`invoke_query_with_dependencies` inside the
   fan-out loop, `crates/snapback/src/local.rs`). So one commit with 100 watchers costs ~half a
   second of pure VM time, and the ceiling within a 10 ms latency budget is only
   ~2 watchers. The matcher that *decides* whether to re-run is ~2 700× cheaper
   than the re-run itself. This is the sharpest result in the set.

3. **The matcher, validation, and ephemeral lanes are not the problem.** At
   1–2 µs each they have enormous headroom; optimizing them would move nothing.
   The ephemeral cursor path in particular sustains ~485k publishes/s, far above
   the 20–60 Hz product target.

4. **Table-granularity validation spuriously conflicted every non-matching
   writer** (rate 1.0) — and **E4 drove it to 0.0** (measured, same day). The
   harness captures a *filtered* query read (`done = true`), lets a
   **non-matching** write commit (`done = false`), and validates a second write
   carrying the stale read. Under table granularity it conflicted every time;
   under E4's predicate-granularity validation (which reuses the live matcher's
   change-affects-query predicate) the non-matching write does not affect the
   query, so it no longer conflicts, while a *matching* write still does. In the
   *serial* local model this was latent (mutations are atomic under the global
   mutex); the harness simulates the interleave at the storage layer to expose
   it. It becomes live the moment writers run concurrently (the L6 reader pool)
   or a client supplies query-shaped optimistic read-sets — which is exactly why
   E4 lands before that arc.
   > **Measurement correction:** the first run of this harness measured an
   > *unfiltered* query, where an insert legitimately adds a row to the result —
   > a correct conflict, not a spurious one. The number above uses a filtered
   > query with a non-matching write, which is the true E4 case.

## Implications for the deferred decisions

- **DK-4 (VM lifecycle) — M2.** The evidence is decisive: fresh-VM-per-invocation
  is the dominant compute cost, and it is paid *again per affected subscription
  per commit*. A warm VM per bundle hash for the trusted-local target would
  attack both the single-writer and the fan-out ceilings at once. This is the
  strongest single lever the numbers reveal. (LLP 0009's five hosted-pooling
  proof obligations are unchanged — this is the trusted-local question.)
  **Done 2026-07-02** — see §After warm VM: single-writer ~4×, fan-out
  ~2.4×, warm invocation ~900 µs vs fresh ~5.5 ms same-run.
- **DK-3 (delta shape + read lane) — M3.** Re-running the whole query per
  affected subscriber is what makes fan-out ~4.9 ms/sub. Op-log deltas (send the
  changed rows, not a whole re-query) and/or a cacheable read lane would cut the
  per-affected-subscriber cost independently of the VM decision. The fan-out
  ceiling of ~2 subs/10 ms is concrete backing for LLP 0022's "cacheable HTTP
  read lane is the most actionable single idea."
- **DK-1 / E4.** The 1.0 spurious-conflict rate confirms predicate-granularity
  validation is worth doing *before* concurrent writers land (L6) — under
  table granularity, concurrency would spuriously reject valid disjoint writes
  at ~100%.
- **L6–L8 (the concurrency arc).** These numbers are the "before" baseline;
  re-run the harness after the reader pool / blocking-work offload / event-driven
  delivery land to quantify the win, as Phase 3 requires. **Done for L6+L7
  (2026-07-02)** — see §L6+L7 re-run above: reads no longer queue behind
  writes (~68× on the read-during-write A/B), write throughput unregressed.

## Open questions

- Multi-run/multi-machine variance and a controlled CI perf lane (the current
  smoke lane checks order-of-magnitude only). A criterion-style harness with
  confidence intervals is the natural next step if a precise regression gate is
  wanted.
- ~~Warm-VM cost once DK-4 lands~~ — **answered 2026-07-02** (§After warm VM):
  ~900 µs per warm invocation, single-writer ~1 050 mut/s, fan-out ceiling ~5
  subs/commit.
- ~~Fan-out with op-log deltas (DK-3)~~ — **answered 2026-07-02** (§M3): the
  projected op-log-delta cost is ~0.32–0.36 µs/affected sub vs ~1 680–1 970 µs
  for the warm re-query (~5 200×), moving the ceiling from ~5–6 to ~28 000+
  subs/commit. The trigger is armed; building it is the Phase-2 implementation
  (server delta emission + the LLP 0034-coordinated wire/kit change).
- Decompose the ~900 µs warm invocation (IIFE parse/eval vs reset sweep vs
  host-call round-trips) if a further per-invocation win is ever needed.

## Status

Draft. The harness and its first numbers are committed and the CI smoke lane is
in place, satisfying LLP 0032 M1's done-when. The numbers are ready to drive M2
(DK-4) and M3 (DK-3); those decisions are made in their own steps and ledgered
in LLP 0000.
