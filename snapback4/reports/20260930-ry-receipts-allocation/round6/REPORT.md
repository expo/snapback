# RY round 6 — static receipt prediction

Date: 2026-10-01. Branch: `sb4-intent/ry-receipts-allocation`.
Merged pinned `origin/main` **d959efe2edf405e1270dce35f75703d89a0ccbf7** first,
retaining both sides of the journal and wasm-budget history, in **077acf1622**.
The incoming main cap was 599,000 B. Read the round 0–5 prompts/reports and
Astra's complete [round-five rejection](ry-r5.astra.md). No push or publication.

## Result

Receipt prediction is now a compiler property. A mutation reads clause-owned
state, calls a receipt primitive, reads transitive maintained/recorded state,
selects a dependent key/index, or consumes a whole receipt row: it becomes
`predicts: never` before any device evaluation. The analysis follows helpers,
aliases, loops, filters, write targets, rules, public maintenance and both
branches, including untaken operands. Schema preparation retains round four's
transitive dependency closure. Helper whole-row returns are recorded before
lowering erases them. The compiler's implicit final-write result remains the
pending image, while an explicit whole-row return is server-only.

`check` emits one located `N_RECEIPT_PREDICTION` note per dependent authored
mutation. `why <op>` carries that same first reason and location. Explicit
`predicts:` assertions refuse `E_NOT_PREDICTABLE` with the reason. The actual
CLI witness locates `messages.recipients` at `schema.q:227:12` in both
[check JSON](cli-check-fixed.json) and [why output](cli-why.txt).

Deleted `value/receipt_taint.rs`, wrapper charges, propagation, count traversal,
the wrapper-only evaluator tests, and the round-three/four receipt read
observers. Seventeen core value/key/wire/read implementations are byte-identical
to pinned main ([hash comparison](hot-path-comparison.json)). Allocator reads,
pending metadata, settlement, and exclusion of pending rows from accounting
remain. Ordinary sends, scope creation, joins, stable-id edits, reaction
upserts and clean inserted id/text use still predict.

Astra P1 is closed before execution: the 8,000-iteration heap reproduction is
statically server-only, queues durably with no message row, survives reopen,
and succeeds on the server with **8,215,208 heap bytes / 184,030 steps**.
The count is slightly different from the review's 8,215,124 because the test
uses its own generated identity lengths; the authored 8,000 × ten-field
array workload is unchanged. Both memory and SQLite compare settled rows to
the server. Astra P2 is addressed by restoring the ordinary value/count paths,
with no per-value receipt work in apps without the clause.

## Runtime boundary

Quarry field and helper names are static. Native mutations are forbidden;
native queries cannot mutate. There is no supported authored dynamic field
path for a runtime detector to cover. Compiled operation facts are trusted
backend input; this work does not validate arbitrary forged IR paired with
forged classification metadata.

Receipt schemas with a missing operation entry, absent classification, or
unrecognized prediction class queue conservatively (with durable reopen tests). Generated
delivered/seen/compact calls retain their admission guard, and the internal
settlement primitive refuses mutation prediction. Provisional allocation is
the intended clause-state reader in an eligible mutation: one runner boolean
is set before it reads the scope. Any subsequent resource/refusal error,
including final constraints and output charging, rolls back the overlay and
preserves outbox custody. A clean-text allocation stress case proves E_BOUND
queues/reopens and the server's actual refusal settles the intent on both
stores. No token is attached to values and no recursive traversal is added.

Early output charging is limited to receipt allocation. The no-receipts
sequence path retains main's ordering and error text; an independent native
comparison asserts the same terminal output E_BOUND on both revisions.

## Reproduction coverage

All prior end-to-end families remain, now with static classification checks
before device admission and server-settlement comparisons. The old 704-scenario
matrix covers non-receipt indexes, point/scan targets, aliasing, loops, conditional
updates, rules, maintained filters/keys/contributions and mirrored parent columns.
The round-five matrix retains **6,344 scenarios** (61 expression families ×
13 sinks × direct/compound source × full/horizon × memory/SQLite). Authored
cases use the compiler's actual classification and check note; compiler-only
IR variants are classified again after substitution, rather than retaining
stale pre-substitution metadata. These internal variants have no standalone
Quarry source spelling; their IR reason is asserted directly.

The **22 compound review probes** cover seven min/max/group/sort/share/shape
cases per store and eight share success/refusal combinations. Their actual
server disposition and final rows are checked. Six new tests add first-reason
locations, transitive helpers and explicit assertion refusals; clean-field
eligibility; Astra's heap case on both stores; and allocator resource custody
on both stores. Ten source shapes exercise the first-reason/assertion test,
including explicit whole-row/null comparison and helper whole-row returns.

## Wasm

Locked Rust 1.97.0, wasm-bindgen 0.2.127 and Binaryen 132 build; gzip measured by
`scripts/build-wasm.sh`. Main was rebuilt in `/tmp/ry-r6-main` at the pinned
commit, not inferred from a historical budget.

| Artifact | Raw B | gzip B | gzip delta from main |
| --- | ---: | ---: | ---: |
| Rebuilt main | 1,994,357 | 598,401 | — |
| Round 4 (recorded) | 2,017,966 | 605,913 | +7,512 |
| Round 5 (recorded) | 2,024,561 | 609,750 | +11,349 |
| Round 6 final | 2,015,329 | **604,725** | **+6,324** |

Final is **5,025 B below round 5**, **1,188 B below round 4**, and +20,972 raw
bytes versus rebuilt main. These are whole-artifact deltas, not independent
feature attribution. The budget is **605,225 B**, exactly final measurement
plus the user-requested 500 B of cross-host headroom. All historical reasons
remain in the budget file; runtime ceilings are unchanged. The full-suite
artifact preceded the output-charge narrowing: 2,015,002 raw / 604,736 gzip.
The final admission refinements add 327 raw bytes and remove 11 gzip bytes.

## Verification and qualification

The whole guide passes **110/110**. Core library checks pass **171**, with one
existing ignore; removing the eight wrapper-only tests explains the reduction
from round five. Receipt tests pass **152/152**. The strengthened static matrix
passes independently on both stores. Ordinary sequence/device disclosure
checks pass **16/16**. CLI check/why, docs budget, main/candidate wasm builds,
no-receipts differential fixtures and ref-check pass. Final affected results
and the full-suite summary are recorded below after completion.

`scripts/test.sh` was invoked exactly once. Its source/configuration snapshot
contains **2,082 files**. The compiler/classifier remained fixed. During
the suite, the no-receipts audit narrowed output charging in `engine/local.rs`
and the final measured cap changed. The final metadata guard also requires a recognized compiler classification,
with its memory/SQLite test extended for absent/unknown classes. These are the
only three changed inputs
([exact hashes](full-suite-source-delta.json)); the full suite qualifies its
starting revision, not a fictitious second run on final source. Final affected
receipt/guide/sequence checks and rebuilt native/wasm comparisons qualify the
narrowing. The source manifests permit independent verification.

## Failures during development

Implementation failures are **ours**, fixed in the final affected checks.
The separately reproduced baseline qualification failure is described below;
none of our implementation failures is relabeled as baseline or environmental. The
[machine-readable ledger](development-failures.json) enumerates every failed
test and compiler error, including repeated runs; full logs are retained as
gzip files.

| Attempt | Failures and resolution |
| --- | --- |
| First check / receipt run | Two removed `point_image` references and missing ReceiptSettled match arm; allocator uses ordinary `get`, exhaustive arm restored. |
| Second receipt run | 15 failures: missing allocated fields in insert results, obsolete runtime-only expectations, and overly broad implicit-write-result classification. Restored receipt result projection, ported static expectations and preserved implicit write prediction. |
| Third receipt run | Seven failures: generated-index names rewritten differently in notes/facts, implicit send/edit returns. Reason now names the dependent field; implicit images are distinct from authored whole-row returns. |
| Fourth receipt run | Three failures: receipt helper location pointed at the generated clause; new compound settlement assertion expected E_INPUT instead of the authored ACCOUNTING refusal. Caller location and expected server disposition corrected. |
| Focused reproductions | `owned-targets`, `columns`, `ordinary`, `runs`, `location`, `composites`, and `static-second` repeat the named causes above; every exact test is listed in the ledger. |
| Final metadata guard witness | The added reopen assertion initially omitted a mutable binding (E0596); corrected before the final receipt run. |
| Benchmark builds | Both harnesses initially needed an explicit BTreeMap type; fixed identically. This was harness setup, not a runtime comparison. |
| Validation setup | Initial static module invocation matched zero tests; first CLI check used the wrong directory; a sequence target was named `sequences` instead of `sequence_by`. Corrected invocations pass; zero-test output is not counted as evidence. |

No policy, ceiling, timeout, retry, contract.ts or publication mechanism was
changed to pass a check. The inherited nominal 60-second complete-suite target
is reported as exceeded, without weakening it. The social starter remains
223 lines, versus 231 before RY. LLP 3000.022 §14.3 and the receipts guide now
state the static rule and the reasons runtime taint was discarded.

## Performance method

The no-receipts ordinary starter compiles to byte-identical complete backend
fixtures (schema, operation classifications, programs, notes and acquired page)
on main and the final compiler: `no-receipts-main.json` and
`no-receipts-candidate.json`. The wasm harness checks identical query data,
coverage, meters, predictable admission and the resulting pending row.
`benchmark.rs` also checks main's terminal E_BOUND for an ordinary sequence
whose output exceeds its ceiling; the receipt-specific backstop does not change
that no-clause refusal.

`benchmark-count.rs` is Astra's count harness verbatim, built on both revisions
with `snapback4-core` default features disabled. Each sample takes the median
of 15 queries; each query counts the same array 2,000 times. The four array
sizes are 0, 100, 500 and 1,000. Its additional 200,000-call `as_array().len()`
loop remains in the raw output. `benchmark.rs` uses the default native feature
set and adds the compiled ordinary 100-row query; each sample discards 20 warmup
queries and takes 61 measured queries. Both external native harnesses use the
same dependency resolution; the ordinary harness's manifest template and lock
are retained. Replace `REPO`, copy `benchmark.rs` to `src/main.rs`, and build
with `cargo build --release --locked` in separate temporary crates.

`benchmark-wasm.mjs` loads the two actual locked web artifacts, alternates
measurement order in one process, discards 20 warmups and measures 81 calls
per side. It asserts complete response equality on every iteration, then
compares an ordinary predicted mutation and its pending query result. Run it
with the main Snapback4 directory, candidate Snapback4 directory and fixture
path. Smoke outputs taken while the full suite was active are retained but
are not the final timing evidence below. Final measurements use the same
CPU affinity for both sides and are taken after validation workers drain.

## Final timing results

Medians of seven interleaved native runs and three paired wasm runs, pinned
to CPU 95. Times are milliseconds per query (2,000 counts per count query).

| Profile / workload | Main ms | Round 6 ms | Change |
| --- | ---: | ---: | ---: |
| native-count / count-0 | 0.4101 | 0.4072 | -0.69% |
| native-count / count-100 | 0.4094 | 0.4082 | -0.29% |
| native-count / count-500 | 0.4259 | 0.4215 | -1.03% |
| native-count / count-1000 | 0.4379 | 0.4353 | -0.59% |
| native-default / ordinary-100 | 0.1664 | 0.1674 | +0.59% |
| wasm / count-0 | 1.0557 | 1.0054 | -4.77% |
| wasm / count-100 | 1.0812 | 1.0332 | -4.44% |
| wasm / count-500 | 1.1374 | 1.0919 | -4.00% |
| wasm / count-1000 | 1.1791 | 1.1743 | -0.41% |
| wasm / ordinary-100 | 1.4494 | 1.4438 | -0.39% |

The count path matches main: no per-count linear traversal returns as array
size grows. Native ordinary-query difference is +0.59%; wasm ordinary-query
difference is -0.39%. Meter receipts and results are identical. This is a
controlled same-host comparison, not an absolute speed claim against the
review's differently scheduled 0.71 ms sample. All medians, individual samples,
affinity and native binary hashes are in [performance.json](performance.json).
The extra native-default count controls also match main (-0.17% to -0.69%).

## Full-suite result and final disposition

Exactly one complete invocation, exit **1**:

```text
== 1 failure(s) in 1625 s
   client tests
```

| Stage group | Result |
| --- | --- |
| Native/wasm builds, docs budget, release guard, package typecheck/build, chat check, chat/Expo typechecks | Pass |
| Rust, including doctests | 4,545 passed; 33 existing ignores; zero failures |
| Fixture wrappers | 9 passed |
| Client tests | 5,726 passed; **one baseline failure**; ten existing skips |
| Serial client models | 79 passed, including 5,000 online session sequences, 5,000 local session sequences and 3,000 online-client interleavings |

The sole failure is `packages/snapback4/test/per-row-react.test.mjs:98`,
“1,000 per-row useQuery hooks: a relevant write renders revalidating answers
with zero loading renders.” It expected `{loading: 0, calls: 2000, rows: 1000}`
and observed `{loading: 87, calls: 2000, rows: 1000}`. Isolated pinned main
reproduces with loading **61**; isolated candidate reproduces with **106**.
All **112 SDK/test files** in the comparison are byte-identical to main;
the mocked no-table HTTP fixture does not use receipt Rust/wasm execution.
This is **baseline**, with scheduling-sensitive counts, not a receipt change
or an unexplained environmental attribution. Main and candidate reproduction
logs and [source hashes](per-row-baseline-source-evidence.json) are retained.
Filed [the baseline follow-up](../../../../issues/20261001-snapback4-per-row-react-revalidation-loading.md).
Full-suite distinct failures: **ours 0; baseline 1; environmental 0**.
The unrelated SDK/test is unchanged; no assertion, timeout or policy was relaxed.

Final source passes: **152 receipt tests**, **110 whole-guide tests**,
**16 sequence/device tests**, **six explicit static/heap/backstop witnesses**,
and **10 social-starter tests on final native/wasm package builds**. The
recognized-metadata guard adds durable cases for missing/absent/unknown
classification on both stores; its final complete receipt run is
`receipts-qualified.log.gz`. These checks cover the refinements after the
single full-suite invocation began. The final wasm cap independently passes.
No second full suite is claimed. The full run exceeds the inherited nominal
60-second target by 1,565 seconds; that policy remains unchanged.

Ref-check and final source-integrity checks are recorded in their logs. All
validation failures, including setup failures, are classified in the ledger.
Artifacts and report are committed with the requested co-author trailer.
Nothing was pushed or published.
