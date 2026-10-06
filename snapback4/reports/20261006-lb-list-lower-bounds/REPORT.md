# LB — inclusive list lower bounds

2026-10-06. Base `8e3062941096d465ec067b00d5eb37c7f1d9f8fd`, branch
`sb4-intent/lb-list-lower-bounds`. All work and execution stayed in the supplied
eb1000 worktree. No other worktree, fleet host, or unrelated process was used.
No push or publication.

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
