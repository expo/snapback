# RY round 5 — receipt taint travels with values

Date: 2026-10-01. Branch: `sb4-intent/ry-receipts-allocation`.
Read the round 0–4 prompts and reports and both complete round-4 reviews
(retained here). At the start, fetched and merged `origin/main`; Git reported
already up to date: `91a111cd85044176ebcc7200449e16e968d276f5` was already an
ancestor of round-4 HEAD `412a4d23a6`. This retains RY, PR and GQ and both
journal histories. The shared remote-tracking ref advanced during this work;
this report qualifies the initial merged baseline plus this round's delta.
Nothing pushed or published.

## Result and review disposition

Astra's P1 is closed at the value boundary. A prediction owns one shared,
sticky receipt-taint token. Reads of clause-owned or transitively derived
state wrap the resulting value, including absent results and compound values.
An inserted row instead marks its owned fields; selecting `m.id` or `m.text`
stays clean. An alias, nested record, array or projection keeps the mark.
Whole-value consumers union nested marks even if they short circuit before
visiting the owned field or discard the marked candidate.

Arithmetic, comparisons, unary operations, formatting and builtins propagate
the mark. Builtin outcomes consume it before evaluating, including error
paths. The special field/projection operations preserve field precision;
scalar fast paths and streaming extrema carry the same dependency.
Typed value access, equality, ordering, key encoding, rules, maintenance and
non-clause writes consume the token. The existing prediction boundary rolls
back all local changes and retains the original intent whether evaluation
succeeded or refused. `share` can neither lose the intent on `E_INPUT` nor
show a false successful send. Record-valued `group` and composite `min`/`max`
use this same mechanism.

Deleted the per-field/per-comparison observation helpers and recursive
source-identity reconstruction. Source boundaries still identify which data
is owned: rule/maintenance images mark their owned fields, and index/range
membership is a state value even when a selection returns no row. The
schema-time dependency closure from round 4 remains. The receipt policy no
longer forces generic row provenance; ordinary sequence provenance remains.
Allocator and raw image/index bookkeeping use unmarked internal images.

Taint is evaluation-only. Existing value/wire encodings are transparent,
caller input cannot deserialize a mark, and write inputs consume and erase
it before storage. Internal output-size serialization does not turn a clean
send into an authored read. Heap-copy accounting includes the wrapper;
opening a marked array moves its payload without an extra collection clone.
No recipe, fingerprint, capability, SDK contract, schema field, queue,
publication behavior, runtime ceiling or retry policy changed. No-clause
schemas install no token and retain their empty-metadata omission; this is
not a claim of zero shared CPU or artifact cost.

Grok's prior shapes and ordinary-flow controls remain covered. Its count
correction is arithmetically mistaken: four indexes × five binary choices
(first/last, full/horizon, update/delete, if/where, same/follow-up) is
`4 × 2^5 = 128` per store, **256** across both. The prior total **704** stands.

## Generated evidence

The new end-to-end matrix contains **6,344 scenarios**: **61 expression
families × 13 decision kinds × direct/compound source × full/horizon ×
memory/SQLite**. Direct sources retain field marks on the inserted row;
compound sources first pass that whole row through `min`, then use the
result in the same operators and builtin families. Every case
compiles, starts a fresh replica, asserts unpredictable admission with no
message row, closes/reopens the outbox, settles the actual server success or
refusal, and compares messages, checks, hook rows and maintained totals.
No diagnostics are skipped. Installing only the selected generated operation
per replica avoids repeatedly installing hundreds of unrelated operations;
it does not reduce the case count or assertions.

| Dimension | Coverage |
| --- | --- |
| Values and operations | Owned field, whole row, shape, list, nested record; all arithmetic/comparison/boolean operators; strings/formatting; collection operations; min/max scalars, records, lists and projections; group/sort fields and records; share fields and records; receipt state |
| Compiler-only forms | ProjectFields, OptionalField, Calendar, CountCapped, SearchPresent, Connected, numeric/record Concat, SameValueZero; only the generated value expression is substituted in otherwise compiled operations |
| Decisions | Require success/refusal, branch taken/untaken, after-insert hook, non-clause write, update rule, update key, delete key, conditional target, maintained contribution, loop, effect payload |

The evaluator unit roster independently exercises every `Builtin` variant
with direct scalar and compound-derived marks (**62 configurations**), all
12 binary operators and both unary operators, plus overflow refusal, clean
insert fields, untaken operands, key encoding and transparent/unforgeable
serialization. Its argument match is exhaustive, so a new builtin must add
a witness. The end-to-end generator covers both division and remainder,
which lower through `Divmod`.

Astra's exact `share` divergence adds **eight cases** (recipient count 0/1,
full/horizon, both stores), proving opposite server success/refusal outcomes.
Seven compound probes per store add **14 cases**, including min/max records,
arrays and shapes, record-valued group keys and count over a whole record.
The original review silently skipped an invalid min-shape probe;
this version uses a valid spread and requires compilation.

Negative control: the new four compound tests and two generator tests were
copied to untouched round-4 product source at `412a4d23a6` in a scratch
worktree. All **six fail**, classified as **baseline: expected round-4 negative controls**. Each generator stops at the first compound-to-text
escape; this is not a claim that every negative scenario executed. The
negative run used the earlier 10-sink matrix; the final matrix adds the
untaken branch, hook and effect sinks, plus the compound-source mode. The exact test patch, hashes, commands and
limits are retained in `negative-control.json` and
`round4-negative-tests.patch.gz`.

## Orientation and scoped documentation audit

Applied `llp-orient` read-only. Snapback 4's fence, RULES, NOT-DOING, LLP 3000
and brief LLP 2000.000 govern. LLP 3000.022 §14.3 owns this change; §§14.1–14.2
retain allocation, ownership, compaction and replay rules. LLP 3000.015 and
LLP 3000.031 retain ordinary sequence/pending/existence behavior. Read the
compiled receipts and language surfaces, updated §14.3 and the receipts
card, and appended one journal entry with final evidence. No new LLP or
application workaround is needed. The social starter remains **223 lines**
(**231** before RY); it and `contract.ts` are unchanged this round. All existing `@ref`s in changed code
still apply.

## Verification

Ran `bash scripts/test.sh` **exactly once**, exit 0. Exact summary:

```text
== 0 failure(s) in 1436 s
```

All thirteen stages passed. Rust: **4,542 passed / 33 existing ignores**;
whole guide **110/110**; client pool **5,727 passed / 10 existing skips**;
fixture wrappers **9/9**; serial models **79/79**, including 5,000 online and
5,000 local sequences. No failures or cancellations. Builds, both app
checks, typechecks, docs budget and release guard passed. The inherited
nominal 60-second suite budget is exceeded; no count, timeout, runtime
ceiling or concurrency policy was relaxed and no worker was interrupted.

**Full-suite failures: ours 0, baseline 0, environmental 0.** Expected
fault-model refusal diagnostics and existing skips/ignores are not failures.
All **2,339** captured source/manifest hashes match before/after that run.
Its wasm rebuild matches the pre-suite **2,023,922 / 609,741** artifact.

**Qualification limit:** the full suite covers the 5,856-scenario matrix
revision before the final audit changes below. It is not represented as a
full-suite run of the final source. Following the once-only instruction,
those changes receive focused core, receipt, guide, device, build, wasm
and social-starter verification instead. Source snapshots and the final
delta identify exactly which evidence covers which source.

The final audit tightened three projection paths: extrema preserve source
marks even for null or clean-field outputs; shaping preserves root marks
from single/multiple bases; compiler projections preserve field marks rather
than passing through the write-input eraser. Two detecting tests failed
before the extrema/shape corrections. It also found numeric rule terms and
effect payloads bypassing value consumers: both failed focused tests before
correction. Rule terms now consume before scalar unpacking/probe dispatch;
effect payloads consume/erase before the write. JSON keys for distinct and
recursive decisions consume at encoding. Point values are marked at the
shared authorized-read boundary, with allocation/presence images kept
separate; projected defaults and inserted derived fields acquire source
marks. The generator gains the effect sink, reaching 6,344 scenarios.

Final focused verification passed against the final source:

| Check | Result | Retained log |
| --- | --- | --- |
| Core library, including eight taint tests | 179 passed, one existing ignore | `final-core.log.gz` |
| Receipt integration, including 6,344 new generated scenarios, the prior 704 and 22 review probes | 146 passed | `final-receipts-guide.log.gz` |
| Whole guide | 110 passed | `final-receipts-guide.log.gz` |
| Device delivery / recorded coverage / sequence allocation | 30 / 24 / 12 passed | `final-device.log.gz` |
| Social starter on final native and wasm builds | 10 passed, no skips | `final-social.log.gz` |
| Native workspace and client package builds | Both passed | `final-build.log.gz`, `final-package.log.gz` |
| References | 525 LLPs, 10,060 refs; zero errors or unchecked refs | `ref-check-qualified.log.gz` |

All 2,339 captured source/manifest hashes match before/after final checks.
`final-validation.json` records commands and the ten source/test files changed
after the full suite, with both hashes for each. The budget is recorded
separately in `artifacts.json`. The unchanged social starter's 10 tests cover
ordinary prediction, offline history, receipts and concurrent DM settlement.

Every failed development test and compile diagnostic is retained and named
in `development-failures.json`: all are **ours, resolved**. This includes the
four final detecting tests and intermediate wasm cap failures. The final
wasm build produced the artifact successfully but returned exit 1 because
609,750 exceeded the then-current 609,741 cap by nine bytes (**ours**). The
budget was set to the measured size and independently checked successfully;
the report does not relabel that build's exit status. The six intentional
round-4 negative-control failures are **baseline** and named in
`failure-index.json`. There were **no environmental failures** and no final
product-test failures. Command/path setup corrections are listed separately
in the development census.

Logs and the exact negative-control test patch are losslessly compressed;
`logs.json` records their original sizes and SHA-256 hashes. No failed log is
discarded. The pinned toolchain was Node 24.13.1, Bun 1.3.14, Rust 1.97.0,
wasm-bindgen 0.2.127 and locked Binaryen 132. The fleet inventory was absent;
verification ran on the local Linux host with 96 available CPUs and the
repository's normal suite scheduling.

## Wasm

Initial merged baseline: **2,017,966 B raw / 605,913 B gzip**. Main's PR/GQ
and lane changes are retained. Final product: **2,024,561 B raw / 609,750 B
gzip**, **+6,595 B raw / +3,837 B gzip (0.63%)**. The budget is exactly
**609,750 B**, no slack, with all prior reasons preserved. This is the
whole-artifact cost of value wrappers/propagation, source marks and codec
handling, less the removed reader observers; it is not independent feature
attribution. The full-suite snapshot was **2,023,922 / 609,741 B**; the final
refinements add **639 raw / 9 gzip bytes** to that snapshot. Measurements use
the locked `build-wasm.sh` toolchain and its `gzip -9 -c <path>` method.
Final raw SHA-256:
`e88c05bebce77d95db2f45c61edb10b6c23876aef24b2041c8ad62a292877356`.
The final budget check is in `final-budget-check.log.gz`.
