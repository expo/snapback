# Wave 12 language-lane status

Updated: 2026-10-15

## Scope

This lane owns the five semantic gaps: ungrouped maintained totals, sound
aggregate and maintained-result narrowing, email text format, enum search,
and exact rounded decimal division. It does not own engine expiry,
`maintained_id`, parser recovery, reserved-name diagnostics or the branch
planner.

## Progress

- Governing LLPs, guide cards, wave evidence lanes 019/021/027/083/091/093,
  NA10 and the pattern ledger read.
- Baseline gate `/tmp/lang-baseline-ready` observed before production edits.
- LLP 3000.013.001 records the semantic and verification contract and is
  linked into `llp/current/`.
- Email schema/runtime/client support landed in `b081f96054`.
- The remaining semantic foundation landed in `0fe7cc1263`: ungrouped global
  maintained counts, enum search, exact three/four-argument rounded division,
  and capture-time count provenance with stale-proof invalidation.
- Cross-runtime evidence landed in `4156cdf7e5`: generated rounded-division
  cases execute through native, Lean and both device stores; simulator and
  device scenarios exercise all five surfaces; standalone Lean witnesses
  cover the semantic fragments outside the row evaluator.
- The shared Lean lowering compile blocker reported in the coordination inbox
  is repaired; both Wave 12 language test executables compile again.
- Affected language tests pass 6/6. Simulator, difftest generation, memory
  device and SQLite device tests pass 1/1 each. Lean passes 54 build jobs, 65
  audited theorems, 88/88 examples and 7/7 fixtures. The focused CLI guide
  lookup regression passes, and `ref-check --verbose` passes.
- The full guide test currently passes 120/123. Its three residual failures
  are in concurrent, uncommitted diagnostics documentation: the maintained
  disclosure example names an undeclared table and exceeds its card budget,
  a personas block duplicates the project identity declaration, and their
  added prose moves the corpus-wide reduction ratio. Wave 12's modified guide
  examples, compiled-block preservation, language execution and email
  expectation all pass in that same run.
- Guide/spec commit and the two fresh blind READY reviews are in progress.

## Concerns / decisions

- Count non-emptiness is an exact transaction fact, never a general theorem
  prover; conservative misses are acceptable, stale acceptance is not.
- The intermediate census's owner-or-manager structural-fanout refusals are
  in the planner/diagnostics lanes: this lane does not change OR-role planning.
- Hidden maintained misses remain null. Zero is produced only after an
  authorization proof.
- Rounded division uses exact signed integer quotient/remainder and an
  explicit enum mode. The four-argument integer form also names result scale,
  so fractional averages need no manual fixed-point multiply; no floating
  point or implicit `avg` is introduced.
