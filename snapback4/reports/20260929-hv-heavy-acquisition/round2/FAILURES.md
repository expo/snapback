# HV round 2 failure ledger

## Qualification

The single full-suite invocation exits 1 with the exact final summary
`== 2 failure(s) in 1339 s`: `wasm build` and `client tests`.

- **Wasm build — ours, unresolved retained HV size debt.** 602,216 B gzip,
  8,497 B above the unchanged 593,719 B cap, reduced by 173 B this round.
- **Client tests — ours, corrected after the one full run's client stage.**
  `web-reachable typed JSON calls all use the codec funnel` flags two direct
  serde calls in the new test helper. `census kills parse, encoded, MQ components
  and container regressions` then sees those same two extra diagnostics (three
  instead of its expected one). The test was already in a cfg(test) module;
  the source census also needs a function-level `#[cfg(test)]`, as existing
  decoder tests use. Added that explicit marker, preserving the regression
  body and every census assertion. The complete census passes **26/26** and the
  staged-image regression passes **1/1** as focused final checks. No product or
  wasm code changes. The full suite was not repeated.

The full client stage records 5,197 passes, these two failures, ten existing
skips and no cancellations. Serial models subsequently pass 79/79 at full
counts. Baseline/environmental test failures: zero. The inherited 60-second
process budget remains exceeded (1,339 seconds); this is not an extra stage
failure in the script's reported summary.
No size budget, test threshold, count, timeout, horizon or durability is relaxed.

## Detecting controls — expected failures

- **Ours, reproduced review finding:** `cold-before.log.gz` observes requests
  of 32 rows under the small caller ceiling. The corrected test passes.
- **Ours, deliberate negative control:** `cold-mutant.log.gz` substitutes an
  unbounded allowance for the saved caller pair. The final regression fails
  on the actual request size. Restored before affected/final tests.
- **Ours, reproduced review finding:** `images-before.log.gz` panics at
  word_heap.rs's field subtraction on whitespace-bearing Row/Map tags around
  nested empty maps. Canonical publication fixes it.
- **Ours, deliberate negative control:** `packing-mutant.log.gz` removes only
  packing-cache invalidation from the IndexedDB open error path. The new test
  observes `row` instead of the accepted `updated` image. Unchanged production
  source passes; restored before final qualification.

## Corrected setup failures

- **Ours, merge handling:** the first resolution script expected one journal
  hunk, but there were two. Its assertion failed; the initial merge commit was
  immediately amended to preserve both sides and remove every conflict marker
  before implementation. Final merge: 8474e39603.
- **Ours, test compilation:** the first staged-image test tried the core-private
  `InternalLedger::with_meter` (E0624). It now uses the public standalone ledger
  and discovers its exact admission threshold through bounded binary search.
  The next attempt used `&MemoryStore` for a mutable transaction (E0596,
  repeated once); corrected to `&mut MemoryStore`. No public API was widened.
- **Ours, evidence-check setup:** two final size assertions used Python's gzip
  encoding rather than the build script's named-file `gzip -9 -c` command.
  Artifact hashes matched throughout; repeating the exact build compression
  command verifies 602,216 B. No artifact or budget changed.
- **Environmental setup:** the lane's llp-orient target and fleet file are
  absent, as in earlier rounds. Read the populated enginefix skill and used
  the already assigned eb1000 worktree; no credential or fixture was copied.
- Read-only path searches included several absent guessed filenames. The first
  browser affected command named two absent test files; Node ran the two
  existing files (17 tests). The separate recorded contract command uses four
  verified files and passes 114 tests. Neither absent file is claimed tested.

No failed control is counted as a qualification pass. See REPORT.md for the
final exact full-suite summary and all remaining failure classifications.
