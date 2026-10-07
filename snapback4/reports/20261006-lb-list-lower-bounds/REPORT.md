# LB — inclusive list lower bounds

2026-10-06. Base `8e3062941096d465ec067b00d5eb37c7f1d9f8fd`, branch
`sb4-intent/lb-list-lower-bounds`. All work and execution stayed in the supplied
eb1000 worktree. No other worktree, fleet host, or unrelated process was used.
No push or publication.

[Round 1](#round-1--review-changes-2026-10-06) below supersedes the initial
tag examples and wasm cap. The initial implementation/verification record is
preserved here; its measurements refer to `0c73dca408`.

## Orientation and the prior rules

The `llp-orient` context pack was scoped to Quarry type parsing/binding,
argument and row admission, device prediction, catalogs, and generated types.
Governing documents: [LLP 3000 §7](../../../llp/3000-snapback4.explainer.md#7-decisions-during-execution)
and [LLP 2000.000 §7.3 and §9](../../../llp/2000.000-keep-the-core-flip-two-substrates.rfc.md#73-prediction-ids-generations)
are in `foundation/`; [LLP 3000.007 §5.4](../../../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md#54-writes-and-schema-patching-defaults)
and [LLP 3000.009 §5.1](../../../llp/3000.009-general-purpose-backend.rfc.md#51-declared-actions-and-routes-typed-handlers)
are in `current/`. Active constraints are one shared interpreter, bounded
runtime work, generated rather than committed application types, and typed
action admission/settlement. LLP 3000.007 §5.4 is amended in this change.
There was no existing decision explaining the list/text minimum asymmetry;
the prior grammar and validators establish it. Hand-off: none.

Read first: `snapback4/AGENTS.md`, the types/language guide sources, core
`engine/validate.rs`, `engine/local.rs`, type lowering, and schema capability
serialization. No Snapback 1–3 gates or runtime bootstrap were used.

| Surface | Before this change | Governing implementation |
| --- | --- | --- |
| Query, mutation, job, action arguments | `[T] <=N`; optional whole lists and nested lists accepted; optional elements refused | [parser::parse_args/parse_type](../../crates/snapback4-lang/src/parser.rs#L872), [scalar_to_arg](../../crates/snapback4-lang/src/types.rs#L407) |
| Table columns | Same list spelling, including nested lists and optional whole columns | [scalar_to_column](../../crates/snapback4-lang/src/types.rs#L384), [ColumnType](../../crates/snapback4-core/src/schema.rs#L426) |
| Shapes and ordinary query/mutation results | Inferred expressions, including list-valued columns/fields; no explicit list return annotation | [type inference](../../crates/snapback4-lang/src/types.rs#L94), [shape binding](../../crates/snapback4-lang/src/bind/program.rs#L820) |
| Helper parameters | Same parser; static inference retains the maximum, like text, rather than proving a minimum length | [type model](../../crates/snapback4-lang/src/types.rs#L94) |
| Action return fields | Explicit `returns { peers: [principal] <=N }`, retained as `ArgType` in `ActionSpec` | [action binder](../../crates/snapback4-lang/src/bind/actions.rs#L35), [result_json](../../crates/snapback4-core/src/engine/actions.rs#L436), LLP 3000.009 §5.1 |

Before the change, `parse_type` required `<=` immediately after `]`, whereas
text accepted `M..N`. The list maximum was a `u32` literal: **4,294,967,295** is
the existing representation ceiling, not permission to allocate that many
items past the runtime meter. Action types separately require a positive
maximum; that policy is unchanged. Input admission allowed `0..N`, returning
`E_INPUT: peers has more than 49 items` above the maximum. Column admission
used recursive `fits`, with `E_INPUT: groups.peers must be [principal] <=49,
not a list of 50`. Both server and device calls use the same value validators:
[validate_inputs/validate_device_inputs](../../crates/snapback4-core/src/engine/validate.rs#L168),
[local prediction](../../crates/snapback4-core/src/engine/local.rs#L104), and
[validate_column](../../crates/snapback4-core/src/engine/validate.rs#L62).
Action result violations become terminal `E_ACTION_RESULT`, with the result
field named rather than echoing its value. Column successor assessment checks
existing values before adoption ([store/successor.rs](../../crates/snapback4-core/src/store/successor.rs#L99)).

Tests were written and run before implementation. The old maximum-only test
passed; three new range tests failed. The exact reported builder spelling
produced `E_QUARRY_SYNTAX: expected "<=", got "1"` at the range's first token,
with the rewrite `write <= followed by the maximum size, for example text <=100
or [int] <=10`. Retained evidence: `tests-first.log.gz`.

## Implemented behavior

`[T] a..b` is inclusive; `[T] <=N` and `[T] 0..N` are equivalent. Parsing
rejects negative bounds, values above the existing ceiling, and `a > b` with
messages naming nonnegative integers, `4294967295`, or minimum/maximum order.
Nested/optional forms retain the existing grammar. Both minima and maxima
apply to operation admission, inserts, updates, upserts, seeds, and device
prediction. Short inputs return `E_INPUT: peers needs at least 1 item; got 0`;
short writes name the column, e.g. `groups.peers needs at least 1 item; got 0`.
The unchanged action-settlement policy applies the same validation under
`E_ACTION_RESULT`. Existing target/authority masking still applies: a seed
uses an addressed upsert, so an invalid absent target reports `NOT_FOUND`
for both the old maximum and the new minimum. Direct row validation reports
`E_INPUT`; the seed test checks refusal and no partial write at both bounds.

Positive minima survive [type lowering](../../crates/snapback4-lang/src/types.rs#L401)
and are checked recursively in [shared validation](../../crates/snapback4-core/src/engine/validate.rs#L84).
All list-sensitive consumers also recognize the new form: wire decoding,
media resolution/placement, asset reservations, key eligibility, disclosure,
revocation, static cost estimates, and Rust type emission. Minimum changes are
checked narrowing; removing/lowering one while keeping the item type and
widening the maximum is additive ([successor classification](../../crates/snapback4-core/src/successor.rs#L183)).
Rejected narrowing preserves the existing rows.

Static list inference still carries the item type and maximum, just as text
inference carries its maximum. Helpers are inlined and have no separate
runtime admission boundary; this change does not add refinement proofs or
helper-call validation. Shapes/ordinary returns infer array types. Explicit
`require count(peers) >= 1 else MEMBERS_REQUIRED` remains supported and tested.

Generated TypeScript still uses arrays, with `Bounds: peers: [principal]
1..49.` in operation argument documentation. Nested element constraints and
optional lists are printed faithfully. Client and handler snapshots are in
`crates/snapback4-lang/tests/fixtures/list-lower-bounds.{api,server}.txt`; generated application
`api.ts` files remain untracked. `guide types` and `guide language` compile the
new range beside text, within existing line/word budgets. The types example's
content hash changes because the example now demonstrates a positive minimum;
the guide's preservation and budget tests remain active.

## Exact catalog and persistence changes

No optional `min` field is added to the old `List` variant: published serde
readers would ignore it. Instead, positive minima use a **new externally
tagged enum variant**, in both `ArgType` and `ColumnType`:

```json
{"List":{"of":"Principal","max":49}}
{"ListRange":{"of":"Principal","min":1,"max":49}}
```

These are exact compact Rust-serializer type fragments. The second is 13 bytes
longer: five for the tag suffix and eight for `,"min":1`. Canonical catalog
JSON sorts inner keys instead: `{"List":{"max":49,"of":"Principal"}}`
becomes `{"ListRange":{"max":49,"min":1,"of":"Principal"}}`, also +13 B.
The bound's digit widths determine other cases. Optional and outer list
wrappers retain their bytes; only positive-minimum nodes change.

Affected containers are `_generations.schema` table-column types;
`_generations.programs` argument types;
action result types in `schema.action_specs` and admitted action declarations;
and device backend metadata containing those schemas/programs. A changed type
therefore changes the ordinary containing schema/program/action digest and
resulting generation identity. Inspection strings display `1..49` instead of
`<=49`; generated TypeScript comments state the range. No capability marker,
protocol version, row/list value encoding, meter ceiling, or digest algorithm
changes. Schemas/programs with no positive list minimum keep the previous
serialization. Tests pin the legacy type fragments and compare complete schema
and program bytes for `<=49` versus `0..49`, including an action result.

An older decoder cannot ignore an unknown `ListRange` enum tag. This also
fences argument-only and table-free backends; it needs no table carrier. The
Darwin test file now includes published 0.2.33 native/wasm refusals for argument,
column, and nested-list backends, plus an old engine reading the persisted
column schema. It expects `unknown variant ListRange`, no device store creation,
and unchanged stored tables on refusal. **Those Darwin cases are unrun here**;
Linux reports the explicit platform skips. The existing capability-free byte
control in that file remains unchanged. Run on your Mac:

```sh
node --test packages/snapback4/test/schema-capabilities.test.mjs
```

## Verification

All Rust/build commands use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`.
The inherited debug-free Cargo profiles and `CARGO_BUILD_JOBS=6` keep this
worktree small and limit compilation concurrency on the shared host.

- Initial regression run: 1 pass / 3 intended failures (`tests-first.log.gz`).
- Server/device boundary tests on memory and SQLite: 2 passed, covering
  0/1/49/50 inputs and computed insert/update/upsert values, plus reopening.
- Guide: 113 passed; examples compile and the language card executes.
- Client native/wasm E2E and schema-capability tests: 5 passed, 7 Darwin skips.
- Full language inventory: 1,488 passed / 11 existing ignored, confirmed again
  by the complete Rust inventory. The initial language run stopped at the legacy
  fixture census after 426 passing tests; moving the new fixture into its own
  directory resolved that failure. The continuation passed 1,061 tests; the
  final extra nested-column case brings the total to 1,488. All 11 list cases
  and both device-store cases pass. Logs retain the initial failure and repairs.
- Generated client/handler snapshots and nested bound documentation: passed.
- Reference audit: 528 LLP documents / 10,426 refs, zero errors or unchecked refs.
- The requested full `bash snapback4/scripts/test.sh` ran every stage, ending
  after 1,301 s with two failed stages. Its Rust artifact build found one
  missing `ListRange` arm in the shared disclosure test generator; that is
  fixed. Because ordinary Rust test binaries did not run, the two event-slot
  client files lacked `target/event-slots-traces.json` and failed at import. The remaining client
  cohort passed 6,412 tests (50 declared skips), and both serial models passed
  all 79 tests. Build, wasm, docs budget, release guard, package/app typechecks,
  package build and fixture-wrapper stages passed. See `full-suite.log.gz`.
- Complete Rust rerun: 301 binaries / 1,014 executions plus workspace doctests.
  It passed 5,074 tests, with six failures in `readauth`: those guide-based
  fixtures still supplied empty tags after the guide example gained a minimum.
  Replacing those three fixture values with one tag preserves all authority
  assertions. The corrected entire `readauth` target passed 81/81. Combined,
  the verified inventory is **5,080 passed / 33 declared ignored / no unresolved
  failures** (`rust-complete.log.gz`, `readauth-final.log.gz`). The language,
  legacy byte controls, disclosure, event-slot fixture generator, isolated
  performance/lifecycle/witness checks and doctests all passed in that rerun.
- Both fixture-dependent client files passed: **48/48**, with runner cleanup
  checks (`client-fixtures-final.log.gz`). Combined with the full run, all 324
  ordinary client files are verified: **6,460 passed / 50 declared skips**,
  plus **79/79** serial model tests and **9/9** fixture-wrapper tests.
  Already-passing full-suite stages are retained; the whole shell script was
  not repeated. There are no unresolved Linux test failures.
- Final worktree disk use: **28 GiB**, below 40 GB. `git diff --check` passed.
  Evidence logs are gzip-compressed with deterministic headers.

Locked `build-wasm.sh` measurements on this same Linux worktree:

| Artifact | Raw | gzip |
| --- | ---: | ---: |
| Unchanged base | 2,117,335 B | 639,888 B |
| List minima | 2,122,648 B | 641,203 B |
| Delta | +5,313 B | +1,315 B |

`metrics/wasm-budget.json` is set to **641,333 B = measured Linux + 130 B**.
The prior cap, 639,941 B, had only 53 B over the rebuilt Linux base, so its
increase is 1,392 B: the 1,315 B code delta plus 77 B restoring the requested
macOS allowance. This is a whole-artifact measurement; no Mac build is claimed.


## Round 1 — review changes, 2026-10-06

Resumed after the host reboot on 2026-10-07.

Starting from `0c73dca4089d7cc3a73cb8283e252bd2829bddfd`. Read the supplied
`~/sb4-intent/reviews/lb-r0.astra.md`, Astra's evidence `REVIEW.md`, and
`lb-r0.grok.md`. Both returned **READY WITH CHANGES** and found no enforcement
defect. The author reports the round-0 Darwin fence passed **10/10** on the
mini, including all three `ListRange` cases. No other host was used in this lane.
The governing context remains LLP 3000.007 §5.4 (updated here), the shared
interpreter constraint in LLP 3000 §7, and action settlement in LLP 3000.009 §5.1.

- Restored `rooms.tags`, `everything.tags`, and `createRoom.tags` to `<=8`.
  The existing comments still teach `[T] 1..N`; `split.people` now demonstrates
  `[principal] 1..8`, where the empty collection is invalid. Removed the
  unnecessary `later`/`demo` tags from execution/read-authority fixtures.
  The language-card execution checks the empty split's clear `E_INPUT`, and
  the regression pins the tag columns' legacy `List` serialization. Both cards
  retain their existing line and word budgets. The types specimen's hash changes
  with its declaration/comment; preservation assertions remain active.
- Incomplete list bounds such as `[int] 1` now explain `<=N` versus an inclusive
  `a..b` range, with a `[T] a..b` rewrite and the types guide. Decimal tokens at
  either endpoint, or after `<=`, report that list bounds must be integers;
  overflow retains its separate `4294967295` diagnostic.
- `schema::validate` now checks column list ranges recursively, including
  optional/nested lists and empty tables. A raw `min > max` produces a
  `tables.<table>.columns.<column>` issue and is refused by engine creation.
  Equal endpoints, including `0..0`, stay valid. This is shared core admission
  code, so the complete suite is rerun. No catalog, persisted-schema or list-value
  encoding changes in round 1.
- Extended the published `doctor` refusal and table-preservation assertions
  to the argument-only and nested fence cases as well as the column case.
  These two additional assertions are **not executed on Linux**; the author's
  10/10 Mac result predates their addition.

### Wasm and host measurements

| Tree / measurement host | Raw | gzip |
| --- | ---: | ---: |
| Round 0 Linux (lane and both reviews) | 2,122,648 B | 641,203 B |
| Round 0 macOS mini (author-supplied) | 2,122,955 B | 641,638 B |
| Round 1 final Linux (locked full-suite build) | 2,122,648 B | 641,203 B |

Set the cap to **641,638 B**, the measured macOS size. The observed host gap is
**435 B gzip**, not 130 B; the cap rises 305 B from 641,333 B. The reason in
`metrics/wasm-budget.json`, commit message and journal states both measurements.
**Shared Rust wasm build inputs changed** (`schema/columns.rs`); the final Linux
sizes are unchanged, but no final-tree Mac measurement is claimed. The author
will remeasure on the mini. No runtime ceiling changes.

### Round-1 verification

Final builds and full-suite runs use
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, six Cargo build jobs and
`CARGO_INCREMENTAL=0`. `cargo clean --profile dev` removed only
this worktree's old development artifacts before rebuilding, recovering 22.4 GiB.

- Tests first: 11 existing passes / 2 intended failures reproduced the parser
  and raw-column admission gaps (`round-1/tests-first.log.gz`).
- Focused guide/list run: **113 + 14 passed**. Includes canonical tag bytes,
  the positive `split` example, malformed bounds, raw schema admission at four
  type depths, existing server enforcement and type snapshots.
- The 2026-10-06 host reboot interrupted the first round-1 full suite after
  the build/wasm/docs/package stages. Its log is retained as
  `round-1/full-suite-interrupted.log.gz`; it is not a completed suite result.
  On 2026-10-07, `git status`/`git diff` confirmed the edits were intact and
  process inspection found no surviving lane test processes. The entire full
  script was restarted with the same environment; every previously unrecorded
  Rust, client, fixture and model check is rerun.
- The restarted full Rust inventory passed **5,083 tests / 33 declared ignores**,
  with zero failures, across 301 binaries / 1,014 executions plus doctests.
  This includes **1,491 language tests / 11 ignored**, **113 guide tests**,
  **81 readauth tests**, **14 language list tests** and **2 device list tests**.
- The refreshed reference audit passed: **528 LLP documents / 10,427 refs**,
  zero errors or unchecked refs (`round-1/ref-check-resumed.log.gz`).
- All **324 ordinary client files passed**: **6,460 tests / 50 declared skips**,
  including both process/wasm list tests. The schema-capability file passed its
  Linux checks and explicitly skipped its Darwin witnesses. Fixture-wrapper
  tests passed **9/9**, and package/app typechecks passed.
- Both full-count serial model files passed: **79/79 tests**. The restarted
  `bash snapback4/scripts/test.sh` exited **0**, reporting **0 failures in
  2,241 seconds**. Build, wasm, docs budgets, release guard, package/app checks,
  the complete Rust inventory, fixture wrapper, all client files and both
  serial models passed in this one completed run. The final Linux wasm build
  again measured **2,122,648 B raw / 641,203 B gzip** under the **641,638 B** cap.
  See `round-1/full-suite.log.gz`; no interrupted-run result substitutes for a
  completed test result.
- Final worktree disk use is approximately **15 GiB**, below 40 GB.
  `git diff --check` passed. Evidence is gzip-compressed with deterministic
  headers. No unresolved Linux failures, push or publication.
