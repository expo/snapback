# WD round 1 — preserve duplicate-key heap semantics

**Astra's P2 is fixed by restoring the old ObjectFields bulk constructor.** The
regression fails on round-0 production source and passes after the fix. All
22 other `small_map` call sites have been audited individually; none requires
another production change. The no-Binaryen artifact is **584,341 B gzip**,
**9,378 B below** the unchanged **593,719 B** cap.

Read the complete round-0 prompt/report and Astra review
(`/home/ccheever/sb4-intent/reviews/wd-r0.astra.md`). Grok's pending review is
outside this round, as instructed. Merged `origin/main`
`cea3b70436a551582410152b52f67d24392193c6` first in merge commit
`94883eef17ce7ca82b6f5f60a120e49aac1d5b23`. Both WD and main journal additions
survive the only conflict; SR and LL source/guide/test changes are preserved.
No semantic source conflict was resolved.

## Correction and detecting test

`ObjectFields::from_iter` once again calls the former
`iter.into_iter().collect::<BTreeMap<_, _>>().into()`. It preserves the last equal
String key allocation as well as the last value, including spare capacity.
Nothing in heap accounting, serde, provenance or the public value model changes.
The helper module documents why insertion cannot substitute generally for bulk
construction. LLP 3000.002 corrects the earlier equivalence claim.

The new test in `crates/snapback4-core/tests/meter.rs` constructs rows through
public `value::object`, compares serialized bytes with the old bulk constructor,
then returns an expression-built array containing that row through public
`engine::local::query`, with a 1,024 B heap ceiling. It checks both capacity
orders, the exact heap charge, completeness, data, cut and cap site, plus the
retained key capacity. It does not normalize or clone the String inputs before
construction; the subsequent row clone shares its Arc image.

| Equal-key capacities, first → last | Old bulk control | Round 0 | Fixed |
| --- | --- | --- | --- |
| 4,096 → 1 | 249 B; complete; `[{x: 2}]` | 4,344 B; heap-capped; null | 249 B; complete; `[{x: 2}]` |
| 1 → 4,096 | 4,344 B; heap-capped; null | First case already fails the regression | 4,344 B; heap-capped; null |

The oracle independently charges four Value array slots plus the row's
40 B header, 80 B entry and last key's capacity. Both rows serialize to the
same bytes; the first serialization assertion passes even in the failing run.
`regression-round0.log` records the required 4,344-versus-249 assertion failure
on the merged tree before changing the constructor. `regression-fixed.log`
records both successful directions. `round0-regression-inputs.json` confirms
that the constructor, local/runner execution and fixture-helper inputs are
identical before and after the main merge. The reverse direction prevents an apparent
fix that shrinks every key to its contents. This is a native in-memory
counterexample; no serialized web-input route is claimed.

[CALL-SITE-AUDIT.md](CALL-SITE-AUDIT.md) gives the result for each of the **22**
production helper invocations and the ObjectFields/JSON constructors. The three
borrowed-key maps in rules/upsert, prefix decisions and history coverage can
retain a different equal String reference. Their temporary consumers compare
contents and select the same last value; no pointer/capacity is observed or
returned. Other inputs are unique maps/singletons, distinct literal keys, or
fresh String clones with equal capacities for equal contents. In particular,
all three read-point rows that can reach meters use cloned `Index::columns()`
names, while the non-SQLite expression path consumes a unique IR BTreeMap.

## Matched size effect

Same Linux x86_64 host, Rust 1.97.0 / LLVM 22.1.6, wasm-bindgen 0.2.127,
Node 24.13.1, GNU gzip 1.12 level 9 and production basename
`snapback4_device_bg.wasm`. The default PATH has no `wasm-opt`; optional builds
explicitly add the retained Binaryen 132 binary. The profile remains `z`, fat
LTO, one codegen unit and panic abort. No cap, dependency feature, diagnostic,
format or build-selection rule changes in this round.

| Merged source | Optimizer | Raw B | Gzip B | Fix delta | Headroom |
| --- | --- | ---: | ---: | ---: | ---: |
| Round 0 after merging main | None | 1,957,172 | 583,326 | — | 10,393 |
| Fixed | None | 1,980,279 | **584,341** | **+1,015** | **9,378** |
| Round 0 after merging main | Binaryen 132 | 1,931,181 | 580,261 | — | 13,458 |
| Fixed | Binaryen 132 | 1,954,344 | **581,808** | **+1,547** | **11,911** |

Merged round-0 optional selection was replayed from the retained unoptimized
artifact with exactly the script's passes/comparisons: `-Os` loses and narrow
folding wins. Temporary comparison gzip uses stdin; every table value uses the
production filename. Fixed builds run the actual `scripts/build-wasm.sh`.
`artifacts.json` binds all four artifacts by SHA-256, raw/gzip size and successful
`WebAssembly.validate`. Artifacts remain ignored under `target/wd/round1`.

Against round 0's original main control (592,979 B), corrected total savings
are **8,638 B without Binaryen**, **11,171 B with Binaryen**. The latter falls
**829 B short** of the original 12,000 B target; round 0's 12,692 B recovery is
not a claim for this corrected artifact. The user explicitly allowed keeping
the old constructor; this correction preserves behavior and stays under the
required no-Binaryen cap. No new combined-HV size/qualification claim is made.

## Bytes and errors

Replayed the existing private 44-command acquisition capture against the matched
merged-round-0 and fixed optimized artifacts. **119 replies, drains and errors
match exactly**, including offline reopen, **12,740 persisted records** and
**5,176,053 persisted bytes**. `differential.json` binds the input and output
hashes. All **105 SDK JavaScript files** in the two comparison copies match;
only wasm differs (`sdk-js.json`). The capture has 41 sync-state reads and three
apply pages, so this is scoped evidence, not a universal semantic proof. The new
native meter test covers the case serialization missed. The existing codec and
full client suites cover their broader surfaces.

Reproduction uses round 0's unchanged `differential.mjs` with its SDK paths and
report output relocated under `round1`; the working copy and raw captured data
remain ignored under `target/wd/round1` and the existing HV private fixture.
Node's module-type detection warning is recorded in the successful log; it does
not change comparisons. No fixture payloads, credentials or row data are added
to the report.

## Qualification

The separate device check passes **1,385 tests** across 73 test binaries,
with five declared ignores. The separate core checks pass **180 tests** with one declared ignore (plus one
nested child-process probe); the whole guide passes **99/99**. Reference
validation passes: 524 LLP documents, 9,940 refs, zero errors and unchecked refs.

The full suite's Rust stage passes **4,344 tests** with **33 declared ignores**:
4,327 tests in the runner's target summaries plus 17 doctests. Historical tally
correction: the archived round-0 log sums to 4,343 under this same method, while
its report stated 4,344; this round adds the one new meter regression. No test
count, assertion or timeout was reduced.

Ran `scripts/test.sh` **exactly once**, exit **0**, with this exact final line:

```text
== 0 failure(s) in 1503 s
```

Every stage passed: cargo/wasm builds, docs budget, release guard, package build
and typecheck, chat check, both app typechecks, Rust tests, fixture wrappers,
clients and models. Fixture wrappers pass **9/9**. Client tests pass **5,245**
with **ten declared skips**, zero failures and zero cancellations. Serial models
pass **79/79**, including **5,000 online + 5,000 local session sequences** and
**3,000 online-client sequences**. No reduced-count environment overrides were
present. The inherited nominal 60-second process budget remains exceeded.

Every full-suite failure: **none**. Classification: **ours 0, baseline 0,
environmental 0**. Separate affected and whole-guide checks also have no failures.
[FAILURES.md](FAILURES.md) records both corrected test-setup mistakes (ours) and
the deliberately failing round-0 detecting regression (ours, now fixed).

Qualification used `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
`CARGO_BUILD_JOBS=8`, `RUST_TEST_THREADS=8`, and Binaryen 132 explicitly on PATH.
The runner kept its normal CPU-aware client pool and Rust stack/thread policy.
All **1,637 recorded source/test/build inputs remained hash-identical** through
the full run (`qualified-inputs.json`); its wasm rebuild matches the retained
fixed optimized artifact exactly. No check, count, timeout, ceiling, refusal
message or serialization format was relaxed. `git diff --check` passes.

Completed logs are retained as ordinary gzip archives; summary JSON and reports
remain plain text. No WD build/test overlapped the acquisition samples below.

## Acquisition effect of the fix

Repeated the unchanged AQ u0500 browser/summarizer tools, relocated only to the
round-1 SDK/output paths. Five alternating AB/BA pairs per mode, followed by a
separate instrumented series, produce **40 fresh contexts**. Both SDK copies
use the merged JavaScript; only the matched before/fixed optimized wasm differs.
The retained production server has the same SHA-256 as round 0
(`bfb300f03f8e386a70aeada718c2694fa8c3b26d7caf4c9303e2eb497eeb9ae3`), using its
preserved private fixture on loopback 49771. It is stopped after sampling.
Login and SDK download are outside the acquisition interval, as in AQ/round 0.

| u0500 median | Merged round 0 | Fixed | Change |
| --- | ---: | ---: | ---: |
| Default acquired | 2,212.5 ms | 2,255.6 ms | +43.1 ms (+1.9%) |
| Worker acquired | 2,451.3 ms | 2,325.0 ms | −126.3 ms (−5.2%) |
| Default first answer | 405.8 ms | 452.6 ms | +46.8 ms |
| Worker first answer | 455.8 ms | 456.4 ms | +0.6 ms |
| Default apply, separate instrumented series | 411.1 ms | 415.1 ms | +4.0 ms (+1.0%) |
| Worker apply, instrumented | 419.3 ms | 419.1 ms | −0.2 ms |
| Default drain, instrumented | 90.1 ms | 90.5 ms | +0.4 ms |
| Worker drain, instrumented | 92.2 ms | 92.4 ms | +0.2 ms |
| Default strict saves, instrumented | 684.1 ms | 692.1 ms | +8.0 ms |
| Worker strict saves, instrumented | 527.0 ms | 518.6 ms | −8.4 ms |

Every context verifies **11,612 stored/expected rows**, zero missing rows or
mismatches, and a complete offline inbox. Wasm high-water memory remains
**57,278,464 B**. Sync bodies remain **3,652,183 B over three responses**.
Fixed uninstrumented ranges: **2,149.8–2,365.4 ms** default and
**2,183.6–2,429.4 ms** Worker. Host load-1 was **65.33–70.29 on 96 logical CPUs**,
with no WD build/test overlap, so these small paired samples do not establish a
general speed improvement or universal neutrality. Default end-to-end and first
answer medians increased; the Worker acquisition median fell. Instrumented phase
medians are independent statistics and cannot be summed into acquisition totals.
`paired/summary.json` and the compressed raw samples retain all measurements.

To reproduce, use the round-0 `measure.py` with `report` relocated to `round1`,
its AQ tool lookup one parent higher, and SDK paths under `target/wd/round1`.
The ignored executable working copy is retained there as `measure.py`. No new
benchmark implementation, public fixture, app surface or server work is introduced.

No push or publication. The implementation commit carries
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.
