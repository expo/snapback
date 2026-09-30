# Failure ledger

Classifications refer to this round. A **baseline control** below means the
explicit round-3 SDK at `88dcf7bd86`, not a claim that current origin/main was
rerun. Intentional negative controls remain failed runs; they are not counted as
passing tests. The no-owner notification defect was also independently reported
on round 2 by Astra. The full-suite result is recorded below.

## Ours: development failures, corrected

- `affected-initial.log`: **online scope-ambiguous change evidence expires while
  waiting for capacity** failed waiting for `work.pending.has(owner)`. Urgent
  work now lives in `priority`; the ordinary map no longer answers that private
  introspection. Use the existing `state(owner) === 'queued'` at both checks.
  No behavioral expectation was relaxed: withdrawal still occurs while all eight
  slots are held. `queue-assertion-correction.log`: 17 passes; the case also
  passes in the final 41-test affected run.
- `memory-final.log`: the newly extended memory test had a missing closing brace
  in its device wrapper and failed module parsing (`Unexpected token ')'`).
  Fixed the test syntax. `memory-candidates.log`: eight passes; subsequent four
  channel-audit cases pass in `other-evidence.log` and the final affected run.
- `round3-control.log`: the initial scaling instrument wrapped global Map/Set
  iterators with node:test mocks. The round-3 10,000-job run exhausted the Node
  heap and aborted after 95.7 seconds. This is **our measurement setup**, not a
  product-memory or environmental claim. Final instrumentation wraps only the
  scheduler's own collections and stops on the first failed linear-work bound;
  both final baseline controls fail on that assertion at 1,000 jobs. The
  uninstrumented 10,000-job benchmark completes for both SDKs. A subsequent
  cleanup signal found that already-aborted owned PID absent; no other process
  was signaled.
- `round3-control.log`: **notification cuts keep unknown dependencies conservative
  and forget applied tables** called the newly added `notified` method on the old
  SDK and failed with TypeError. This is **our incompatible negative-control
  selection**, not a behavioral reproduction. Excluded that new internal-method
  unit from final negative controls; it passes on the implemented code.

- Final reference audit setup: `ref-check-final.log` ran from `snapback4/`
  rather than the repository root, so it found **zero LLP documents** and
  reported **1,302 unresolved references**. All 1,302 diagnostics are retained
  in that log. This was **ours**, a wrong-working-directory invocation, not
  1,302 broken references or an environmental failure. The correctly rooted
  `ref-check-complete.log` passes (525 LLP docs / 10,015 refs, zero errors).

## Baseline: expected behavioral controls

`round3-control-final.log`: 14 tests, 12 failures / two existing intersecting-cut
passes. Every failed name:

1. wasm: no-owner revocation must retire remembered content
2. process: no-owner revocation must retire remembered content
3. wasm: notification fences an unremembered in-flight direct answer
4. process: notification fences an unremembered in-flight direct answer
5. wasm: resumed handle inherits unrelated notification
6. process: resumed handle inherits unrelated notification
7. queue selection scales linearly, priority=false
8. queue selection scales linearly, priority=true
9. wasm: cancelled resumed watermark releases running
10. wasm: expired resumed watermark releases running
11. process: cancelled resumed watermark releases running
12. process: expired resumed watermark releases running

The initial `round3-control.log` also fails names 1, 2, 5, 6 and 9–12 before the
instrument/selection corrections above. Those eight are repeated evidence, not
additional unique regressions. Revocation returns Bob's protected content;
unrelated resumes and cancelled/expired metadata wait forever on the held
response; scaling exceeds the operation-count bound.

`round3-candidates-control.log`: four tests, four failures:

13. wasm: notification fences a saved candidate at recovery
14. wasm: notification fences a saved candidate at approval
15. process: notification fences a saved candidate at recovery
16. process: notification fences a saved candidate at approval

`round3-other-evidence-control.log`: four tests, four failures:

17. wasm: partition refusal retires no-owner memory
18. wasm: credentials retires no-owner memory
19. process: partition refusal retires no-owner memory
20. process: credentials retires no-owner memory

All 20 distinct regressions fail their behavioral assertions on round 3 and pass
on the final SDK. No timeout was increased, skip added or count reduced to fix
any run. Held negative-control responses release during teardown.

## Environmental

No verification failure is attributed to the environment. Shared-host workload
limits interpretation of latency comparisons, but it is not used to relabel a
failed test. Normal reading commands initially guessed several absent filenames;
those exploratory lookups changed no files and are not verification results.

## Full suite and final state

Exactly one invocation: **exit 0**, **`== 0 failure(s) in 1244 s`**.
Full-run failures: **ours 0; baseline 0; environmental 0**. Rust 4,368 pass,
client pool 5,440 pass (ten existing skips), fixture wrappers nine pass, serial
models 79 pass. No cancellation or new skip. The corrected private queue
assertion and final four no-owner tests were installed before the client phase;
all final source/test hashes match at completion. The single full run was not
repeated or relabeled using targeted results.
