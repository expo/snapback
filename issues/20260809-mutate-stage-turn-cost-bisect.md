# Mutate stage-turn serialized cost grew ~1.5–2x across the de96ced6e→af0fbd5bf drift window

**Opened:** 2026-08-09 · **Severity:** P2 performance (scale-tier) ·
**Owner seam:** unknown — bisect target; LLP 0199 storage modularization is
the leading suspect · **Found by:** Lane C profiling of
`issues/closed/20260808-p1-commit-turn-overhead.md`

Lane C's obs0 profiling isolated, besides the (now fixed) two-turn stale
cascade, an **unconditional** per-attempt serialized-cost increase that is
not scheduler-conditional and not explained by the LLP 0200 Phase-1
commit-turn additions (whose post-durable cost measured 0.26 ms p50):

- Stage turn (Hermes handler + staging reads under the global Local lock):
  p50 23.5 ms / mean 28.7 ms per attempt at af0fbd5bf (turn_prof, N=134
  attempts on the 5.5M-row baseline).
- Pre-Phase-1 binary (spike branch de96ced6e), same arm shape:
  response-to-response gap mean 26.9 ms vs 42–51 ms post; first-op-of-burst
  latencies 94/124/166 ms → 116–240 ms.
- The commit-turn body diff c966a7745→af0fbd5bf is instrumentation-only,
  so the slowdown lives somewhere in the ~212-commit drift window
  de96ced6e→af0fbd5bf, which includes the LLP 0199 storage.rs
  modularization rewrite.

Ask: bisect the window with the committed A/B harness
(`demos/zerobugs/control/scripts/run-oq4-arm.sh <arm> on fixed 0 mixed`,
settle p50 + response-gap mean as the metric, N≥2 per candidate on a quiet
host — run-to-run noise on a loaded host reached ±40%), identify the
regressing commit(s), and either fix or file against the owning seam.
Numbers to beat after the Lane C fix landed: obs0 trigger settle p50
83–139 ms (N=2).
