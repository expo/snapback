# RY round 2 — provisional receipt reads retain write custody

Date: 2026-09-30. Branch: `sb4-intent/ry-receipts-allocation`.
Round 1: `649e8f9b69f8b7506a5181e175fe5716695d37d5`.
Merged `origin/main` at `267788df36` first, in `bf58d4a003`.
The only conflict was the append-only journal; both complete entries survive.
Read rounds 0–1 prompts/reports and both complete Astra/Grok round-1 reviews.
This round's prompt is retained in `prompt.md`. Nothing pushed or published.

## Result and review disposition

A refusal after consuming provisional receipt information now keeps the mutation
in the durable outbox with `predictable: false` and no predicted changes. It
survives reopen and succeeds when submitted against the settled server state.
The existing admission conversion and outbox lifecycle remain the mechanism;
there is no new retry protocol or blanket suppression of ordinary refusals.

- **Astra P2 rule/postcondition finding:** the shared assigned-field predicate
  covers receipt ordinals, recipient counts, floors and scope counters as well
  as ordinary `sequence by`. Both rule probes use it, including old/next fields;
  final-exists keys use it before probing. Tests cover a device at counter zero,
  a competing server allocation of ordinal one, then insert/update or
  insert/delete at ordinal two, plus the final-exists permit lookup.
- **Astra P2 and Grok High pending-null finding:** `ReceiptSettled` records the
  same overlay provenance it uses to choose false. A generated null cannot
  short-circuit away the dependency. Tests cover insert-and-require in one
  mutation, a separate receipt-dependent follow-up to a pending send, and
  pending-membership `receiptMember` and `progress` guards.
- **Grok High rule/aggregate finding:** both old and next recipient-count rules
  queue. Row-keyed predicate tracking covers receipt source columns and member
  floors, in live recounts and when reusing a stored non-expiring count.
- **Additional audited paths:** residual rule equalities, scalar extrema,
  collection grouping/sorting, recorded captures and generic maintained filter/sum reads now
  observe provisional dependencies. Each executable added defect has a
  regression that fails on the round-1 engine. Optional field reads and the
  read-rule probe share the same predicate defensively; supported receipt
  declarations already forbid private field ownership and assigned-field read
  authority respectively.

The generated recipe, schema capability and fingerprint remain v4. This fixes
implementation omissions in the existing v4 contract; it adds no receipt
meaning, field, state, operation or authoring syntax. Server allocation,
index-count snapshots, join floors, replay, receipt ownership, metering and
settled accounting are unchanged. LLP 3000.022 §14.3 and the compiled receipts
card now explicitly describe dependent refusal custody. The social starter
stays **223 lines**, versus **231 before round 0**.

## Regressions and audit

`declarative_receipts/dependencies.rs` has 48 device cases: 24 per store,
including two generated-query-body harnesses and ordinary-refusal controls.
An additional compiler test checks private-target recorded-capture rejection. Every deferred
case checks actual outbox membership, `predictable: false`, no predicted writes,
reopen, submission with the original write/row identities, and server settlement.
Follow-ups remain queued while their antecedent settles.

`receiptMember` and `progress` are generated queries, not callable Quarry
functions. Their tests clone the **actual compiler-generated IR**, change only
its operation name/kind and insert a non-null require before each return. This
executes both the member conditional and progress's early null branch under
mutation admission; it does not invent callable source syntax or copy the
receipt implementation into a test. The ordinary `receipt(m)` witnesses use
compiled authored mutations without IR changes.

The exact round-1 negative control temporarily restored all changed engine
files from `649e8f9b69`, ran the same 44 tests, and restored round 2 in a `finally`
block. Result: **6 passed, 38 failed**, all failures at the intended local
admission assertion, no compiler errors. Passing controls are direct recipient
count reads, scalar sums using ordinary expression projection, and a terminal
refusal after an untaken receipt branch, each on both stores. The initial
round-2 run passes **44/44**. Logs: `exact-round1-negative.log.gz` and
`regression-final.log.gz`. The four later public-capture regressions also fail
on the exact round-1 engine at that assertion (**0 passed, 4 failed**), then
pass with the correction (`capture-round1-negative.log.gz`,
`post-suite-lang.log.gz`). Final receipt target: **115/115**, including all
48 device regressions and the private-capture compiler control.

| Reader / path checked | Disposition |
| --- | --- |
| `runner.rs` ordinary field access, including variable fast path | Already used `sequence_field_is_provisional`; shares the new assigned-field predicate. Direct-count negative control already passed round 1. |
| `SequenceProbe::field`, old/next/update/delete rules | Fixed; ordinal update/delete and old/next recipient-count tests fail round 1 on both stores. |
| `ReadProbe::field` | Uses the same predicate now. Receipt binding rejects assigned fields deciding read/insert authority; no new authoring allowance. |
| `write.rs` final-exists field/next-field keys | Fixed; both stale-ordinal permit witnesses fail round 1. Viewer/literal keys are not provisional fields. |
| `ReceiptSettled` and generated receipt/member/progress nulls | Fixed; both same-invocation provenance and earlier outbox overlays tested. Existing accounting model still checks pending rows cannot enter settled projections or delivery debt. |
| `witness.rs` extra equalities after a unique-key rule lookup | Fixed before residual filtering. Full-acquisition residual rule tests fail round 1; an earlier horizon-limited version already queued for missing coverage. |
| `row_views.rs` source predicates and member bounds | Fixed shared predicate walk. Both live expiring scans and reused stored non-expiring counts tested, for zero-contributing provisional messages and changed provisional join floors. |
| Generic maintained filter/sum/group-key reads | Input dependencies observed at selection, including absent/zero targets. Filter and sum tests fail round 1. This is conservative across pending source groups and remains bounded by the existing device work allowance. |
| Scalar sum / max / min | Sum projections already use ordinary expressions (control passes round 1). Direct extrema field access now observes provenance; max regression fails round 1. Min shares that exact branch. |
| Collection `group` and `sort` key reads | Fixed before reading/comparing keys. Two-message tests observe wrong grouping/order on round 1 and settle successfully on the server. |
| `OptionalField`, wildcard/projected rows | Optional access now uses the common helper. Receipt assigned fields cannot also have private field ownership. Projection/wildcard field expressions take the ordinary tracked path; merely returning a row does not refuse a write. |
| Point reads, ordered scans, write-target selection and rule probes | Already call `observe_sequence_selection`; it includes receipt-assigned index columns even for an empty suffix. Generic aggregate source observation now also occurs here. |
| Unique/if-absent/cap/collision checks | Already call `observe_sequence_columns`, which includes receipt fields and now shares the common predicate. Internal allocator reads remain prediction construction rather than authored decisions. |
| Ownership checks, member updates/removals, delivered/seen/compact | Existing structural/runtime guards remain: illegal authored writes refuse; receipt reports and existing membership changes queue before predicted accounting changes. |
| Recorded one-hop captures | Receipt messages can be public. Capture now tracks the provisional target, and the shared assigned-field predicate resolves recorded paths so later aggregate reads of pending captures also defer. Same-invocation and separate-follow-up witnesses cover both stores. Private receipt targets remain compiler-rejected; mutable scope counters cannot be immutable capture targets. |
| Maintained-column mirroring | Server-only; devices preserve synchronized columns. No new predicted receipt read there. |
| Allocation, floor stamping, recipient snapshot and counter commit | Server-only authoritative path unchanged; device suffix construction deliberately uses held/provisional positions without promoting them to receipt evidence. |
| `local::predict` and device admission/replay | Existing dependent-error conversion now receives the missing dependencies. Deferred entries remain unpredicted until settlement. Ordinary nondependent/short-circuited terminal refusal remains terminal. |

This audit covers direct engine consumers and maintained readers of the clause's
fields. It does not claim universal transitive provenance for arbitrary
application-authored copies, or admission of forged raw-IR receipt descriptors.

## Orientation and documentation audit

Applied `llp-orient` read-only before edits. Scope: core prediction readers,
receipt generated operations, admission/outbox and tests. Snapback 4's own fence,
LLP 3000, LLP 2000.000 and adopted `rules/RULES.md` govern the work.

- Current LLP 3000.022 §14.3 governs provisional history, settled-only receipt
  evidence, versioning and nonterminal dependent refusals.
- Current LLP 3000.015 §2 governs sequence-dependent refusal conversion;
  §3 and LLP 3000.020 §3.2 govern row-keyed prediction and dependency observation
  across empty ranges and residual predicates.
- LLP 3000.007.003 §3.2 and the maintains guide govern public, immutable, one-hop recorded captures; prediction remains replaceable and server capture authoritative.
- LLP 3000.001's replacement/replay rationale applies unchanged. The client
  pending metadata/existence contract (LLP 3000.031) is unchanged.
- Existing `@ref`s still resolve. Updated the governing §14.3 paragraph and the
  compiled receipts guide alongside code; no new LLP, workflow gate or registry.
- No demo implementation changed, so no new demo diary was needed. The exact
  starter remains covered by the full client suite. Hand-off: none.

The fleet inventory file was absent on this Linux host. Tests use its existing
warm target and pinned Node 24.13.1, Bun 1.3.14, Rust 1.97.0,
wasm-bindgen 0.2.127 and workspace Binaryen 132.0.0. No test counts, timeouts,
concurrency settings or runtime ceilings were relaxed.

## Verification

Affected commands ran from `snapback4/`:

| Check | Result | Log |
| --- | --- | --- |
| Declarative receipts, whole guide, row-keyed views, extrema, frontend regressions and four delivery targets | 336 passed; 1 existing ignore | `affected-lang-guide.log.gz` |
| Whole guide (included above) | 107 passed | same log |
| Device delivery, read authority, sequence, disclosure and unread range | 134 passed | `affected-device.log.gz` |
| Core sequence and disclosure | 46 passed | `affected-core.log.gz` |
| Recorded-capture compiler control | 1 passed | `capture-control.log.gz` |
| Docs budget and reference validation | Passed; no reference errors | `docs-budget.log.gz`, `ref-check.log.gz` |

The receipt target includes the allocation/concurrency, replay, prediction,
refusal-withdrawal and accounting models inherited from rounds 0–1. Its first
broader run was 110/110; the subsequently added compiler control brings the
target to 111 tests in the full suite. The four capture cases added afterward
bring the final target to 115, all passing in the subsequent affected run.

All development failures are **ours** and resolved. `development-failures.json`
names every failed case/diagnostic per retained log, including expected negative
controls. Test scaffolding needed corrections to argument decoding, transition
rule syntax, generated-query invocation, scalar aggregate types and optional
comparisons. The initial private-target capture probe became a compiler-rejection control.
A later public-target runtime probe found a real capture dependency omission,
covered by four additional regression cases. Its first fixture lacked an insert
rule; after correction all four failed at the intended provisional refusal. One group-key observer initially
missed a Rust borrow. Early root-relative command path mistakes changed no
product files. The first wasm build refused the inherited ratchet; the final
measured increase is recorded below. No development failure is classified as
baseline or environmental.

Ran **`bash scripts/test.sh` exactly once**, exit **0**. Exact summary:

```text
== 0 failure(s) in 1271 s
```

All 13 stages passed. Rust workspace: **4,501 passed, 33 existing ignores**;
clients: **5,577 passed, 10 existing skips**, zero cancellations;
fixture wrappers: **9/9**; serial client models: **79/79**, including both full
5,000-sequence walks. The docs-budget stage separately runs one Rust guide
budget test. Full-run failures: **ours 0, baseline 0, environmental 0**; the
complete failure list is empty. Intentional `E_AUTH` messages come from fault
models, not failed tests. `full-suite.log.gz` and `full-suite-summary.json`
retain the complete evidence. The inherited nominal 60-second bar is exceeded;
no timeout, test count, concurrency setting or runtime ceiling was changed.

All **1,779** scoped source/manifest hashes match before and after that run.
**The full suite predates the final public-capture correction.** During its
serial models, an isolated scratch harness confirmed that public receipt messages
can be capture targets and reproduced the missing dependency. After the suite
completed, changed `engine/recorded.rs` (capture observation),
`engine/sequences.rs` (recognize recorded paths), the regression file (four
cases plus corrected private-control name/comment), and the wasm budget.
`post-suite-source-delta.json` gives those four input hashes; `final-source.json`
gives the final snapshot. LLP/report/journal updates are documentation.

Subsequent final-code checks:

| Check | Result | Log |
| --- | --- | --- |
| Receipts, recorded attribution, maintained views, row-keyed views, whole guide | **283 passed**, including receipts 115/115 and guide 107/107 | `post-suite-lang.log.gz` |
| Device maintained views | **29 passed** | `post-suite-device-maintains.log.gz` |
| Device recorded coverage and row-keyed views | **48 passed** | `post-suite-device-recorded.log.gz` |
| Core recorded capture unit tests | **4 passed** | `post-suite-core-recorded.log.gz` |
| Final wasm build and ratchet | Passed, exact final bytes below | `final-wasm.log.gz` |
| Final reference validation | 525 LLP docs, 10,033 refs, zero errors/unchecked | `final-ref-check.log.gz` |

These are **364 affected Rust passes** after the capture correction, with no
failures or ignores. The full suite was not repeated, per the round instruction.
No claim is made that its 1,271-second result includes the later correction.

## Wasm

**2,005,133 B raw / 601,629 B gzip** on the standard size-first build.
This is **+1,361 B gzip (~0.23%)** over round 1's 600,268 B cap. The common device
interpreter needs the missing rule/postcondition/settlement dependencies and
coverage of derived scalar/maintained readers and public recorded captures.
Set the ratchet exactly to the measured **601,629 B**, with no slack. This is a whole-artifact change, not
per-function attribution. Server allocation/counting remain server-only.
The first wasm build correctly failed the prior cap; the raised cap is justified
here, in `metrics/wasm-budget.json`, the journal and the commit message.

The full suite built the earlier artifact at 2,004,883 B raw / 601,592 B gzip
(`suite-artifacts.json`). The capture correction adds 250 B raw / 37 B gzip.
The intermediate build's 37-byte ratchet refusal is ours and resolved by the
final exact cap; `artifacts.json` records the final digest.
