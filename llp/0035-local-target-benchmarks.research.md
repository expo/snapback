# LLP 0035: Local-target benchmarks

**Type:** Research
**Status:** Draft
**Systems:** Runtime, Storage, Realtime, Sync, Ephemeral state, Testing, Performance
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-01
**Revised:** 2026-07-01
**Related:** LLP 0000, LLP 0003, LLP 0008, LLP 0009, LLP 0012, LLP 0022, LLP 0032

## Summary

This is the artifact of [LLP 0032](./0032-decision-and-implementation-hardening.plan.md)
**M1**: the in-repo benchmark harness (`src/bench.rs`, run by the
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
| Per-invocation VM cost | **~3 900 µs** | `RuntimeGuard::create` + `install_host` + `eval` of a trivial handler touching no data |
| Single-writer throughput | **~227 mut/s** | sequential `createTodo` commits under the global instance mutex (the single-writer breaking point) |
| Matcher cost (skip path) | **~1.8 µs/sub** | per-subscription cost to evaluate and skip an *unaffected* subscription |
| Live fan-out cost (affected) | **~4 900 µs/sub** | per *affected* subscription: re-run the query (a full VM invocation) + serialize + enqueue |
| Fan-out ceiling @ 10 ms | **~2 affected subs/commit** | 10 ms ÷ per-affected-sub cost |
| Read-set validation cost | **~1.3 µs/dep** | per row dependency validated at commit |
| Spurious-conflict rate (disjoint) | **1.0** | fraction of disjoint-row concurrent writers to a queried table that conflict under table-granularity validation |
| Ephemeral publish | **~485 000 pub/s (~2 µs)** | per-publish cost with a handful of subscribers (the 20–60 Hz cursor target has ~4 orders of magnitude of headroom) |

## What the numbers mean

1. **The VM is the whole cost.** At ~3.9 ms, a fresh VM per invocation is ~3
   orders of magnitude more expensive than the matcher, validation, or an
   ephemeral publish. Single-writer throughput (~230/s) is just `1 / VM-cost`;
   the commit itself is in the noise. **Anything that reduces per-invocation VM
   cost is the single biggest lever in the system.**

2. **Live fan-out is catastrophically VM-bound.** Each affected subscription
   costs ~4.9 ms because the current design **re-runs the subscription's query
   in a fresh VM on every commit** (`invoke_query_with_dependencies` inside the
   fan-out loop, `src/local.rs`). So one commit with 100 watchers costs ~half a
   second of pure VM time, and the ceiling within a 10 ms latency budget is only
   ~2 watchers. The matcher that *decides* whether to re-run is ~2 700× cheaper
   than the re-run itself. This is the sharpest result in the set.

3. **The matcher, validation, and ephemeral lanes are not the problem.** At
   1–2 µs each they have enormous headroom; optimizing them would move nothing.
   The ephemeral cursor path in particular sustains ~485k publishes/s, far above
   the 20–60 Hz product target.

4. **Table-granularity validation spuriously conflicts every disjoint writer**
   (rate 1.0). In today's *serial* local model this is latent (mutations are
   atomic under the global mutex, so disjoint writers never actually interleave —
   the harness simulates the interleave at the storage layer to expose it). It
   becomes live the moment writers run concurrently (the L6 reader pool) or a
   client supplies query-shaped optimistic read-sets. This is the number E4/DK-1
   turns on.

## Implications for the deferred decisions

- **DK-4 (VM lifecycle) — M2.** The evidence is decisive: fresh-VM-per-invocation
  is the dominant compute cost, and it is paid *again per affected subscription
  per commit*. A warm VM per bundle hash for the trusted-local target would
  attack both the single-writer and the fan-out ceilings at once. This is the
  strongest single lever the numbers reveal. (LLP 0009's five hosted-pooling
  proof obligations are unchanged — this is the trusted-local question.)
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
  delivery land to quantify the win, as Phase 3 requires.

## Open questions

- Multi-run/multi-machine variance and a controlled CI perf lane (the current
  smoke lane checks order-of-magnitude only). A criterion-style harness with
  confidence intervals is the natural next step if a precise regression gate is
  wanted.
- Warm-VM cost once DK-4 lands: re-measure per-invocation cost with a pooled VM
  to confirm the projected win and set the new fan-out ceiling.
- Fan-out with op-log deltas (DK-3): measure per-affected-subscriber cost when
  the delta is the changed rows rather than a full re-query.

## Status

Draft. The harness and its first numbers are committed and the CI smoke lane is
in place, satisfying LLP 0032 M1's done-when. The numbers are ready to drive M2
(DK-4) and M3 (DK-3); those decisions are made in their own steps and ledgered
in LLP 0000.
