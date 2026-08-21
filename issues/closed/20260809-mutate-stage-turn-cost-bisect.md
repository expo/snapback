# Mutate stage-turn serialized cost grew ~1.5–2x across the de96ced6e→af0fbd5bf drift window

**Opened:** 2026-08-09 · **Severity:** P3 (downgraded 2026-08-15; was P2) ·
**Owner seam:** measurement — equal-boundary A/B on a quiet host ·
**Found by:** Lane C profiling of
`issues/closed/20260808-p1-commit-turn-overhead.md` ·
**Re-scoped:** 2026-08-15 attribution lane (codex gpt-5.6-sol, orchestrated;
endpoint-equality claims independently re-verified by the orchestrator)

## 2026-08-15 attribution: the claimed regression is not established

A source-attribution lane walked the full 212-commit window and refuted the
premise rather than finding a culprit:

- **The headline comparison mixes metric boundaries.** The post-window
  number is a **stage-turn** mean (28.7 ms at af0fbd5bf); the pre-window
  number is a **response-to-response gap** mean (26.9 ms at de96ced6e). No
  pre-window stage-turn metric was recorded. Same-boundary arithmetic gives
  28.7/26.9 ≈ 1.07×, not 1.5–2×, and the boundaries are not comparable
  anyway.
- **The measured path is byte-identical at both endpoints.** The staged
  writer-gate wrapper (`crates/snapback/src/server.rs` 444–635 @ de / 469–660 @ af), the
  complete recorded-mutation staging block (`crates/snapback/src/local.rs` 13470–13890 @ de /
  10616–11036 @ af), the buffered preview/apply block (`crates/snapback/src/storage.rs`
  6758–6955 @ de / 6769–6966 @ af), the fixture-relevant query executor and
  point-read blocks, and `crates/snapback/src/runtime.rs` (identical git object
  `898b50a09…`) do not change across the window. Orchestrator re-verified
  the four load-bearing equalities directly with git (2026-08-15).
- **The leading suspect is refuted.** The LLP 0199 storage modularization
  (`a065cb9c9`) moves cold migration/projection/connection/test code between
  modules; the hot staging/preview/read bodies stay in place, byte-identical.
  Rust module splits add no runtime call boundary. LLP 0225 (which
  superseded 0199) treats the split as an ownership boundary, not a dispatch
  boundary — consistent with this finding.
- Scheduler (`37a928956`), trace/counters (`af32e2c06`), and auth/catalog
  candidates are refuted for the zero-observer arm (details in the lane's
  classified commit map; obs0 wakes no scheduler and the fence/watermark
  events are observer-conditional).
- The absolute ~29 ms stage cost at 5.5M rows is real but **predates the
  window**: the clone-then-transactional-dry-run choreography (pre-window
  merge `0bc4f3d59`, dry-run internals older) is required by LLP 0059's
  exact-preview authorization contract and is not a regression. Skipping the
  preview by buffered table names would not be semantics-preserving
  (projection/membership effects can carry authorization-bearing rows).

## Remaining ask (the only way to reopen the regression claim)

Equal-boundary A/B on a **quiet host**, both endpoints instrumented
identically: emit `stage_queue_under_lock_ms` (mutex acquire → spawn_blocking
closure entry), `stage_body_ms` (around `stage(&mut guard)`), and
`stage_tail_under_lock_ms` (stage return → `drop(guard)`) from
`with_snapback_staged_authorization_write`; build de96ced6e and af0fbd5bf
with the same toolchain/profile/trace setting; ≥3 reps per endpoint,
alternating order, `run-oq4-arm.sh <arm> on fixed 0 mixed`. Expected from
source equality: stage-body p50 delta within ~2 ms, no consistent direction.
A repeatable +15–25 ms stage-body delta falsifies the attribution (then
check binary/toolchain identity before anything else). A delta confined to
queue-under-lock or response gap attributes the original observation to host
scheduling/contenders, closing this ticket outright. If a response-gap delta
appears with equal stage body, rerun once with `SNAPBACK_SPIKE_TRACE` off
(expected residual ≤1–3 ms; the synchronous emit path exists at both
endpoints).

Until someone runs that on a quiet host, no stage-turn optimization work
should cite this ticket as its regression evidence.

## Resolution — 2026-08-20 triage

Close as **disproved regression / no current defect**. The investigation found
that the headline compared different boundaries and that the measured hot path
was byte-identical at both endpoints. A quiet-host equal-boundary experiment
would be useful metrology, but it is not a reason to keep a product-regression
ticket open. If future same-boundary evidence shows a repeatable regression,
file a new ticket with the instrument identity and raw endpoint receipts.
