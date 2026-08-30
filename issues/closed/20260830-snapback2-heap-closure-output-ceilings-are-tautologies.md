# snapback2-core: the heap, closure, and output ceiling checks in `check_all` cannot fire

**Status:** Closed
**Systems:** snapback2, certificate
**Severity:** P2
**Author:** Claude Fable 5, directed by Charlie Cheever
**Date:** 2026-08-30
**Related:** LLP 1001 §4/§10, `snapback2/crates/snapback2-core/src/certificate.rs:169`, `spikes/bounded-programs/REPORT.md` ("Known S1 limits": heap/output/closure byte fields are coarse estimates)

Found by the report-only delta review of lane A (2026-08-30) after the lane had used its fix rounds. `Checker::check_all` clamps the heap and closure byte estimates to their ceilings before comparing, and sets the output estimate equal to its ceiling, so those three refusals are unreachable: a scan with `take = 4095` estimates 4,195,328 closure bytes against the default 4 MiB ceiling and certifies. Examined/index/rule-probe/steps/write ceilings are real and tested.

Fix: compare the raw estimates (and make the output estimate a function of the program's result shape and `take`), add a test per ceiling that a program over each one is refused with the ceiling named, and re-measure the S1 corpus so no existing program flips. The estimates themselves stay coarse until a real allocator/serializer proof replaces them (LLP 1001 deferred list).

Minor, same review: the live error digest covers only `error.code()`, so two different `E_OVERFLOW` messages on successive reruns are `changed: false`; include the message.

## Resolution — 2026-08-30

Resolved the whole ticket. `Checker::check_all` now compares raw heap and
closure estimates with their ceilings, and output bytes are estimated from the
program's return shape, schema column/argument shapes, accumulator pushes, and
scan/loop bounds. Closure retention is data-flow-sensitive: a scanned page's
declared-max rows are charged only when the page or its elements reach the result
or a collection that grows with the page; count/sum/len and fixed-width loop
folds retain 64 bytes of metadata. Text/Json use their full declared maxima (the
1 KiB value is only the missing-table fallback). Focused tests cover inline and
let-bound count, compiler-lowered reduce, returned slices, growing result lists,
and isolated named heap/output/closure refusals.

Added one named-refusal regression test for each of heap, closure, and output,
plus a certification sweep over all 76 frozen corpus cases and their preludes.
The owner `data` page is capped from each table's declared row maximum so wide
rows remain certifiable. No corpus program flipped from certified to refused.
Live runtime-error digests now include both code and rendered message;
successive distinct `E_OVERFLOW` messages report `changed: true` in the new
regression test.

Verification from `snapback2/`:

- `./scripts/test.sh` — passed (Rust workspace, 76/76 evaluator corpus, 44/44 compiler checks).
- `node scripts/measure.mjs --check` — all green (core test 20.34 s,
  check-project 0.376 s, doctor samples 0.464/0.163 s).
