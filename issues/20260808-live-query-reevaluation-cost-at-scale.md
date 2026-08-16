# Live-query re-evaluation cost under mutation fan-out is minutes-scale at 5.5M rows

**Opened:** 2026-08-08 · **Severity:** P1 (product-shaped: correct but unusable under hot load) · **Owner seam:** D2 (incremental deltas / bounded re-evaluation) + D4 (stream lifecycle) per the LLP 0183 review round; evidence anchor for acceptance.v2 margins

## Measured

`snapback-control-hot.zb5.v10.json` (immutable receipt): with six streaming
`issueListV2` observers (1,000-row windows) open at the 5,549,113-row store,
the 48 sampled mutation settle latencies span **111 ms to 148 s, median
~74 s**. Convergence and correctness are exact; streams stay live (after the
invalidation fix); the cost is pure re-evaluation fan-out — every buffered
mutation re-runs each observer's full opaque JS handler (bounded list-engine
assembly measured at ~1.3 s standalone at this scale × 6 observers × queued
depth).

## Why it matters

This is the structural ceiling of opaque live queries: correctness scales,
latency does not. Zero-class comparators serve deltas from replication
rather than re-execution. Any workload with concurrent writers and multiple
live windows hits this shape.

## Ask

Not a quick fix — a workstream input: incremental/differential delta
computation for admitted query shapes (D2), or bounded re-evaluation
scheduling with per-subscription staleness contracts (D4), with the hot
gate as the acceptance instrument. The zb5-hot machinery reruns this
measurement in ~80 min; `demos/zerobugs/control/scripts/diag-hot-stream.mts`
iterates in minutes against a persistent baseline.

- **Claim released 2026-08-08:** the sweep (session dc26442d) landed what it could and recorded the remainder above/below; the open remainder is unclaimed and free for any session to pick up.

## Ruling (2026-08-08)

LLP 0191's author rulings commission this seam: the coalescing
measurement spike runs immediately
(`20260808-oq4-coalescing-measurement-spike.md`), and the D2/D4
owner-Specs are commissioned with the five-rung ladder, drafted after
spike data (`20260808-d2-d4-owner-specs-commission.md`). This ticket
remains the evidence anchor.

## Progress 2026-08-08 — rung-1 coalescing lane landed (ticket sweep)

LLP 0191 §1's ladder rung 1 — **re-evaluation coalescing, scheduling only** —
is implemented and tested. Design and semantics: LLP 0008 §"Dated decision —
post-commit fan-out coalescing (2026-08-08)". Mechanism: when a commit's
fan-out dispatch detects backlog (previous frame's measured evaluation cost ≥
25 ms and this commit arrived within one evaluation-cost of that frame
finishing), its changed rows merge into one pending frame; a backstop flusher
task (installed with the coalescer by the serving process; sticky signals;
10 ms delay + FIFO lock queue) delivers the merged frame once at the latest
version. Starvation bounds (frame count / merged-row count / absolute hold
age) force an inline flush if the backstop cannot run. Exclusions: permission
resyncs, authorization events, and refresh signals always run inline;
subscriptions resynced during a pending window are pinned to the replace lane
at flush. `SNAPBACK_LIVE_COALESCE_DISABLED=1` restores strict per-commit
fan-out for A/B runs.

Evidence (synthetic, zb5-hot shape at reduced scale —
`tests/live_coalesce_v0.rs`, `bench_synthetic_burst_coalescing`, run with
`--ignored --nocapture`): 30k rows, six ordered 1,000-row-window observers
(replace/re-query lane), 16-mutation burst:

- coalescing OFF: 1.846 s total, 96 delivered frames (16 × 6)
- coalescing ON: 0.119 s total, 6 delivered frames (1 × 6), 16 commits
  deferred — 15.6× wall, 16× frames

Correctness suite (same file, non-ignored, CI-run): burst→one-frame +
exact convergence, mixed create/update/leave/delete/create-then-delete
convergence, starvation-bound inline flush, refresh supersession, coalescer
absent ⇒ byte-identical legacy behavior, and the backstop task end to end.

**Expected effect at the measured scale:** the 74 s median was evaluation ×
observers × queue-depth; coalescing bounds it at ~one evaluation per observer
per drain cycle (~1.3 s × 6 ≈ 8 s per cycle at 5.5M rows), so settle should
collapse from minutes to single-digit-seconds. The zb5-hot gate (~80 min) has
**not** been rerun here; requalify per LLP 0189 when the hot profile next
runs, ideally A/B via `SNAPBACK_LIVE_COALESCE_DISABLED`.

**Remaining (this ticket stays open; rung numbering follows LLP 0191 §1's
revised five-rung ladder):**

- The OQ4 measurement spike (now commissioned:
  `20260808-oq4-coalescing-measurement-spike.md`) with its predeclared
  axes — this landing is not that spike and not the de facto D4 design;
  the spike should run its A/B arms against this landed lane via
  `SNAPBACK_LIVE_COALESCE_DISABLED`.
- Rung 1 remainder — evaluation cancellation and the settlement-isolation
  contract (commit ack must not queue behind an in-progress flush's
  evaluation turn).
- Rung 2 — affected-read precision (extend the captured-dependency matcher
  vocabulary; record match/skip/fallback decisions).
- Rung 3 — authority-partitioned shared evaluation (trust answer shared
  with LLP 0190 §4).
- Rung 4 — incremental view maintenance for admitted D2 graph shapes;
  rung 5 — delta-fed local replicas (D3 via the shared interface).
- zb5-hot A/B rerun at 5.5M rows as the acceptance instrument
  (`SNAPBACK_LIVE_COALESCE_DISABLED=1` as the control arm).
- Coalescing counters (`LiveCoalesceStats`) are deliberately not yet on the
  serialized inspect surface (would rotate drift-gated inspect schemas);
  expose them when the D4 Spec lands its observability section.
- The force-replace-after-resync lane has reasoning + conservative-direction
  coverage but no direct automated test (needs an auth-scoped harness).

## OQ4 spike results (2026-08-08) — hypothesis not confirmed; settlement isolation is the lever

The commissioned spike ran all predeclared axes (twelve A/B arms at 5.5M
rows; full numbers and disposition in the closed ticket
`issues/closed/20260808-oq4-coalescing-measurement-spike.md`; artifacts on
branch `spike/oq4-coalescing-measurement`). Headlines for this anchor:

- Coalescing did **not** produce single-digit-second burst settles
  (trigger p50 23.6 s on vs 33.2 s off; whole-inventory median 23.0 s vs
  17.8 s): ~90% of delivered evaluation frames ride the authorization
  lane, which the landed rung-1 lane excludes by design.
- **Settlement isolation dominates**: zero observers → whole inventory
  settles at ~0.2 s; commits are durable early but responses wait up to
  ~10.7 s behind subscriber evaluation — refused, commit-free mutations
  included. Settle p50 scales ~0.2 s → ~8 s → ~20–40 s at 0/1/6 observers.
- Sustained 4/s writes are **throughput-bound at ≈0.85 settles/s with or
  without coalescing** (both arms settled ~105/480 in-window).
- Matcher: 0 conservative fallbacks, 0 delta-lane deliveries; skip rate
  matches the trigger partition — rung 2 is not the binding constraint on
  this inventory. Same-partition six observers cost the same as mixed six —
  rung 3 memoization has ~6× measured headroom.
- The 521-vs-12 delivery discrepancy is resolved as a
  unit-and-lifecycle accounting difference (see the closed spike ticket §7).

## Auth-lane and write-turn diagnostic (2026-08-08, post-spike)

Code-level follow-up resolving the spike's two open "why"s (trace evidence:
`spike/oq4-coalescing-measurement` arms; code references at main 55566dc0a):

1. **Commit plus fan-out is one exclusive write turn.**
   `dispatch_live_data_fanout` runs inside the commit path's `&mut self`
   turn (`src/local.rs` ~22820–22856), so with six auth-scoped observers a
   frame costs ~5–6 s of serial evaluations and the next mutation's
   **commit** — not merely its response — waits. Trace: burst-on commits
   6212–6219 became durable at 6.6/16.5/18.2/18.4/28.2/29.0/36.8/50.4 s for
   dispatches that all left the client within 400 ms. Corollary: the rung-1
   coalescer is **structurally starved** on the served path — deferral
   requires a commit to arrive while a pending frame exists, but serialized
   commits arrive only after the prior frame finishes (hence 4/24
   deferrals; the synthetic 15.6× drove `LocalSnapback` with test tunables
   that widen the window). Settlement isolation — moving fan-out off the
   write turn — is therefore not only the latency fix but the enabler that
   makes the already-landed coalescer effective.

2. **Auth-scoped subscriptions never ride the plain replace lane.** In the
   replace branch, `subscription.authorization.is_some()` routes every
   re-evaluation through `invoke_authorization_resolution` +
   `deliver_authorization_snapshot`, emitting `authorization_invalidation`
   envelopes (`src/local.rs` ~24447–24560). On a sessions-mode store that
   is *every* subscription — hence 75/84 auth-lane frames — so the
   coalescer's authorization-lane exclusion covers ~90% of this workload.
   Not a misrouting defect: it is the designed auth-mode delivery envelope.
   The D4 Spec must either scope coalescing to include data-driven
   authorization resolutions or split the lane (data invalidation vs true
   permission change) so the exclusion protects only the latter.

3. **Quarantine churn is the client's classification of resolution-less
   auth frames.** Roughly half the delivered auth frames in a burst arm
   (119 of 231 callbacks) arrived without a usable resolution ticket and
   quarantined the query boundary until a later resolution restored it
   (`packages/snapback-contract/index.mjs` ~1651–1666). The
   quarantine-recovery lifecycle is chartered D4 content.

## Progress 2026-08-09 — LLP 0200 Phase 2 (B-4 churn closed)

Data-driven re-resolution deliveries no longer quarantine the boundary
they feed (bc26e015b): the recorded quarantine→snapshot flicker (24
callbacks per six-observer burst arm; 135 sustained) measured **0** on the
burst arm and 42 non-delivery-caused residual hints on sustained
(`issues/20260809-sustained-reprojection-hints-still-quarantine.md`) after
the same-envelope atomic application fix — B-4's root cause was the
client's two-commit application of one envelope, not missing tickets.
Authority transitions are now measurable on this inventory (probe arm,
d885c5a8f): fence-applied p95 0.09 ms; restoration p50 4.6 s / p95 7.0 s.
Full Phase-2 record and the split H-3 verdict: LLP 0200 §6c. The
convergence-vs-serial-floor clause remains open on evaluation cost — the
D2 sharing/widening ladder this ticket anchors.

## 2026-08-16 — G1 same-principal memoization landed and measured

LLP 0209 G1 landed (five commits ending a2cd51af0): scheduler-level
memoization of identical (function, canonical args, complete handler-visible
authority identity, evaluation cut, drain cycle) subscriptions behind
`SNAPBACK_LIVE_EVAL_MEMO_DISABLED=1`, drain-cycle-scoped, matcher/fence
retired, oversize-refused clone-free under a 256 MiB budget.

D2-H1 (2026-08-16, regenerated era-stamped fixture, N=2 interleaved): on the
six-observer **shared-session** arm, per-turn evaluation p50 869 ms → 42 ms
and total serialized evaluation time 25.9 s → 10.7 s (one real evaluation
per trigger version instead of six). The harness's original six-observer
shape minted six *sessions* of one user — sessionId is handler-visible, so
the sound pre-G0 key cannot share across sessions and that shape gains only
~15%. Cross-session sharing for one principal is a G0 target (declared
inputs proving sessionId non-consumption). Full record: LLP 0209 v0.3
revision note; arms under the g1-memo worktree's
`demos/zerobugs/fixtures-local/oq4-arms/`.

The structural ceiling this ticket names remains G2/G3's to remove (per-node
precision + delta lanes); G1 removes the same-key multiplier only.
