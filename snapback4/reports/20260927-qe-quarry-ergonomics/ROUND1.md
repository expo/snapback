# Lane QE — round 1, 0.4.5

2026-09-27. Branch `sb4-intent/qe-quarry-ergonomics`.
Read the round-0 prompt, report, journal entry and both complete blind reviews.
Merged fetched `origin/main` **3369ae543** into round-0 **c16d71e88** as
**a05192ae7**. The journal was the only conflict; both complete histories remain.
No push or publication. Every round-1 commit has the requested Astra co-author.

## Findings and commits

| Finding | Commit | Result |
| --- | --- | --- |
| Astra Medium: unsound list items | `2c5d06ec7` | Reject incompatible nonempty item joins, including nested scalar conflicts and references to different tables, before they can become Unknown and later acquire another type. |
| Both Low: restoration coverage | `a3ef8e9a5` | The exact two-sweep job refuses the later cross-chunk accumulator. Deleting `self.caller_loops -= loops` makes the test fail. |
| Astra item-join compatibility follow-up | `951390b66` | Keep `once [recipient, period]` as a heterogeneous positional effect key; lower each coordinate in source order without assigning the tuple a homogeneous list item type. |
| Astra/Grok Low: recursive rewrite | `bcb3e2b0e` | Walk assignments for `+`, preserve complete self-append origins, and route reassignment failures to the fixed-item self-append rewrite. |
| Grok Low: prepend pricing | `4317ca16e` | Count append/prepend increments, initial contents, argument bounds and nested iterations; leave doubling, arbitrary assignments and unresolved open/cyclic growth on the fallback. |
| Supervisor: calibration #22 narrowing | `174a155f3` | Narrow repeated pure calls over stable arguments, retaining existing scope, branch and loop invalidation. Document the contract and update the historic refusal fixture. |
| Finding 5 follow-up | `794ac556a` | Include implicit shape snapshots; keep the executable example without duplicating the authorization census; add its scale expectation. |
| Finding 1 compatibility follow-up | `74e4bb434` | Give the heterogeneous provenance fixture an explicit common ID type; all original wasm/process assertions pass. |

## Changes, file by file

Paths below are relative to `snapback4/`, except the LLP.

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/types.rs` | Add strict nonempty item joins, recursively through objects/optionals/sequences. Empty sequences keep their exemption. |
| `crates/snapback4-lang/src/bind/program/joins.rs` | Give incompatible scalar/reference items a located `E_QUARRY_TYPE` and compatible-item rewrite; preserve row-kind `E_QUARRY_SHAPE_JOIN`. |
| `crates/snapback4-lang/src/bind/program/expr.rs` | Use strict literal joins; share ordered argument lowering for effect-key tuples; apply guarded call refinements after normal expansion. |
| `crates/snapback4-lang/src/bind/program/control.rs` | Use strict append joins; retain whole assignment origins and walk conditional concatenations; handle early recursive reassignment failures; classify expanded helper effects and narrow guarded calls. |
| `crates/snapback4-lang/src/bind/program.rs` | Store successful helper-effect summaries and call result types, with a lexical fact anchor for calls having only constant arguments. |
| `crates/snapback4-lang/src/bind/program/pure_calls.rs` | Identify calls by helper plus ordered stable arguments and snapshot identity. Store facts on every argument root using the existing field-refinement machinery. Exhaustively inspect expanded IR for table/connection reads, clocks, minted IDs and writes. |
| `crates/snapback4/src/scale/collections.rs` | Recover bounded concat increments through the same length census as Push, adding initial contents. |
| `crates/snapback4-lang/tests/list_expressions.rs` | Scalar/reference/nested conflict regressions, positive empty/optional-reference cases, and all three direct/conditional recursive-growth rewrites. |
| `crates/snapback4-lang/tests/helper_placement.rs` | Exact two-sweep restoration regression. |
| `crates/snapback4-lang/tests/pure_call_narrowing.rs` | Builder expression and nested-call execution; branch/surviving-guard behavior; implicit shape/aggregate snapshots; effect/argument exclusions; reassignment and loop invalidation of every argument dependency. |
| `crates/snapback4/tests/scale.rs` | Include the new pure-call `expiration` example in the constant-operation expectation. |
| `packages/snapback4/test/read-through-provenance.test.mjs` | Explicitly expose generic IDs in its heterogeneous row fixture; retain every original wire/provenance assertion. |
| `crates/snapback4/tests/scale_intent.rs` | Prepend/append, bulk/argument increments, nonempty initials, doubling and later-assignment certificates. |
| `crates/snapback4/tests/scale_extremum_expressions.rs` | Compare recovered prepend/bulk bounds with actual examinations; update two expectations that pinned the former nonempty-Push overestimate. |
| `crates/snapback4-lang/tests/ergonomics.rs` | Replace the old two-refusal assertion with compilation and execution of the original pure-call fixture; the bind-once form still compiles with the same table definitions and result type. |
| `crates/snapback4-lang/tests/fixtures/qe/ergonomics-m5.q` | Move the unchanged historical fixture from the top-level directory: it now compiles and would otherwise enter the frozen durable compatibility inventory. |
| `crates/snapback4-lang/src/guide/language.rs` | Add an executable repeated-call expiry example; shorten repetitive comments to stay within the existing word budget. |
| `crates/snapback4-lang/src/guide/types.rs` | Explain pure-call eligibility, guarded scope and invalidation, pointing to the compiled language example. |
| `crates/snapback4-lang/src/guide/programs.rs` | Point helper authors to pure-call narrowing. |
| `crates/snapback4-lang/src/guide/why/E_QUARRY_TYPE.md`, `E_ADOPT.md` | Replace the now-obsolete blanket bind-once fact with the precise purity exception and remaining rewrite. No new diagnostic code. |
| `crates/snapback4-lang/tests/fixtures/guide-fact-homes.json` | Update that same changed fact; retain all 133 fact homes. |
| `crates/snapback4-lang/tests/guide.rs` | Execute the language-card expiry query for present and absent TTLs. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | Record strict items, tuple distinction, recursive rewrite and cost behavior in §5.1; pure-call narrowing and invalidation in §5.2. |
| `JOURNAL.md`, this report | Append round-1 implementation and qualification evidence without rewriting round 0. |

## Forms and outcomes

- `return ([] + [x]) + [y] + []`, with `x: a`, `y: a ?`, keeps
  `[a ?] <=2`. Nested empty lists and compatible records still join.
- `for x in ([1] + ['x']) + [2]:`, `[1, 'x', 2]`, and
  `([x] + [y]) + [x]` with different reference tables now refuse at compile
  time. Nested list/object conflicts and nonempty Unknown-to-int recovery
  also refuse. Row-kind conflicts keep their existing diagnostic.
- A helper called in one sweep cannot hide a carried `total` in the next:
  `E_QUARRY_PLACEMENT` at line 10 of the review's exact job.
- `xs = [xs] + []`, `xs = xs + [xs]`, and
  `xs = (xs + [xs]) if flag else xs` all refuse with
  `use xs = xs + [x] with x of a fixed item type`. The repaired loop runs
  and returns `[1, 2]`; mutually recursive accumulators retain the rewrite.
- Five `xs = [i] + xs` iterations followed by one `count(notes)` per item
  cost **40,965** certified examinations, matching Push. Two-item increments
  cost **81,930**; an initial item adds **8,193**. `xs = xs + xs` remains
  **8,193,000,000**, the existing step-ceiling fallback. Real engine tests
  match six examinations for a prepend into `[0]` and twelve for nested bulk
  append followed by point-read projections.
- The builder's exact expression now compiles and runs:

  ```quarry
  expiresAt: now + windows.ttl(c.disappearing) if windows.ttl(c.disappearing) != null else null
  ```

  Using the comparative's actual `windows.q`, `now = 100` and `24h` return
  `180100`; the off setting returns null. Wrapping the call with
  `identity(windows.ttl(c.disappearing))` has the same results. These are the
  accelerated benchmark TTL values, not calendar-day claims.
- Names, literals, lexical snapshot fields and nested pure calls qualify as
  arguments. Both calls still execute; this is type refinement, not caching.
  Table-reading helpers, direct database-read arguments, writes, effects and
  clock reads keep `E_QUARRY_TYPE` and the bind-once rewrite. Facts do not
  escape a conditional branch or survive changing any argument root, including
  a loop-carried scalar used before its next reassignment.

## Tests and negative controls

Evidence is under the ignored `target/lane-qe-r1/` directory.

| Evidence | Outcome |
| --- | --- |
| `item-join-before.log` | The incompatible-item regression fails on the pre-fix compiler, which accepts the reported expression. |
| `restoration-mutation.log` | Removing exactly `self.caller_loops -= loops` makes the new two-sweep test fail: the compiler incorrectly accepts the job. Restored before committing. |
| `recursive-before.log` | The direct nested accumulator fails the new assertion because its old rewrite says to use a different local. |
| `scale-before.log` | The prepend regression fails with 8,193,000,000 versus expected 40,965. |
| `pure-calls-before.log` | The builder expression and guarded pure call fail to compile with the old present-number/bind-once diagnostic. |
| `affected-compiler-final.log` | **152/152**, including the whole guide **86/86**, placement **8/8**, lists **12/12**, pure calls **5/5**, joined shapes **17/17**, historical ergonomics **22/22**, frozen compatibility **1/1**, and randomized control flow **1/1**. |
| `scale-final.log` | **41/41**: scale **20/20**, scale intent **8/8**, expression-extremum/collection pricing **13/13**. |
| `affected-engine.log` | **1/1**, helper/inline equality of all emitted payloads across multiple committed job chunks. |
| `focal-test-before.log` | The implicit shape snapshot regression fails with the bind-once rewrite before the follow-up fix. |
| `readauth-final.log` | **81/81**, including the unchanged authoring census. |
| `provenance-final.log` | **16/16**, all wasm/process tests that failed in the full run, with no assertion changes. |
| `build-final.log` | Final CLI build passes before the client provenance check. |
| `ref-check-final.log` | **516 LLP documents, 9,602 references; zero errors or unchecked references.** |

Development checks exposed and resolved three integration issues: mixed `once`
keys need tuple lowering; the newly accepted historic fixture must not enlarge
an unrelated frozen inventory; and the guide's existing word/fact budgets must
remain intact. No budget or baseline bytes were raised. The changed historic
refusal and two conservative cost assertions intentionally now expect the new
behavior. Ordinary branch/join and meter tests retain their assertions.

## Design context and limits

The `llp-orient` skill link was uninitialized locally; used the adjacent
`lane-lx/vendor/llp/skills/llp-orient/SKILL.md` to orient against this checkout.
The scoped context is LLP 3000's Snapback 4 fence, LLP 2000.000 §6's
static authorization/runtime meter boundary, LLP 3000.007 §5.1–§5.2 and
§10's language/flow semantics, and LLP 3000.019 §3.2's structural length
census. The supervisor's round-1 instruction supplies the new pure-call rule;
no separate design or approval was inferred. The existing LLP is updated in
place. No unresolved reference or hand-off is needed.

No requested work was stopped or redesigned. Implementation choices left open
by the brief: classify effects after normal helper expansion, so named shapes
and transitive helpers share one check; reuse lexical field-fact invalidation;
keep heterogeneous effect-key tuples; and include the list's initial contents
in its recovered length. Repeated calls are never memoized or removed.

There is no engine, authorization, disclosure, durability, IR-format, runtime
meter, version or budget change. Every modified source file remains below
1,500 lines. Guide leads stay within 45 words, all original compiled blocks
remain, and all 133 fact homes are retained with the deliberate pure-call fact
correction. The round-0 optional-filter `E_QUARRY_BOUND` limitation remains;
its full reproduction and inner-if rewrite are in `REPORT.md` §Comparative
first pass and remaining limitation. In the shared profiles/members fixture,
replace the helper domain with
`members where .principal = p.principal and (amount = null or .unread = amount)`
and call it from a profiles sweep with `amount: int ?`. Both helper and inline
forms report `E_QUARRY_BOUND: members has no cap over this prefix; this position
needs a bounded page`. Run
`cargo test -p snapback4-lang --test helper_placement unbounded_optional_domains_still_need_a_page_bound_in_both_forms`
to reproduce. Move the optional predicate into an `if` inside the loop to keep
streaming the principal domain without introducing a product cap.

## Qualification

Rust 1.97.0, Node 24.13.1, Bun 1.3.14; eight Cargo build jobs, dev/test debug
information and incremental compilation disabled, file-descriptor limit 65,536.
Frozen Bun install passed without changes. No new dependency.

The pre-suite wasm build is **1,981,512 B raw / 572,053 B gzip**,
SHA-256 `5436a3d17dc29dbee2148bbad942ddea866526e48f9d159e96be5a6c18fe1969`.
The unchanged **572,841 B** gzip budget leaves **788 B**. Round 1 changes no
wasm input: core/device sources, Cargo.lock and build-wasm.sh are identical to
the merge base `a05192ae7`. The increase over round 0 belongs to merged main;
it is not attributed to these compiler/certificate changes.

The frozen full run is at `174a155f3`. Its Rust phase completed in **919 s**:
**241 binaries / 954 executions plus doctests; 3,860 passed, 2 failed,
24 ignored**. The client phase completed in **198 s**: main **2,532 passed,
16 failed, 10 skipped**; all seven additional shards passed **56/56**.

Every individual failure in that full run is **ours** (18 total; no baseline or environmental failures):

| Test | Cause |
| --- | --- |
| `snapback4-device::readauth::census::authoring_census` | The new types-card block contains no table, so the census prepends the whole language example and gains another set of mutation occurrences. |
| `snapback4::scale::language_operation_classes` | The new guide query `expiration` is missing from the expected `Constant` operations. |
| `wasm: retained nested rows follow source parents on reordered pages` | Shared provenance fixture joins children/reactions IDs without an explicit common `id` type. |
| `wasm: retained nested rows follow source parents on shifted pages` | Same fixture startup refusal. |
| `wasm: composed tables sharing an ID keep independent retained rows` | Same fixture startup refusal. |
| `wasm: projections without id replace a retained copy using its source envelope` | Same fixture startup refusal. |
| `process: retained nested rows follow source parents on reordered pages` | Same fixture startup refusal. |
| `process: retained nested rows follow source parents on shifted pages` | Same fixture startup refusal. |
| `process: composed tables sharing an ID keep independent retained rows` | Same fixture startup refusal. |
| `process: projections without id replace a retained copy using its source envelope` | Same fixture startup refusal. |
| `wasm: an identityless object merges its identified child rows` | Same fixture startup refusal. |
| `wasm: an unidentified sibling preserves paired parents and drops an unpaired current row` | Same fixture startup refusal. |
| `process: an identityless object merges its identified child rows` | Same fixture startup refusal. |
| `process: an unidentified sibling preserves paired parents and drops an unpaired current row` | Same fixture startup refusal. |
| `wasm: an anonymous nested page appends only retained history after a partial rejoin` | Same fixture startup refusal. |
| `wasm: an in-place edit under an anonymous nested page replaces its retained copy` | Same fixture startup refusal. |
| `process: an anonymous nested page appends only retained history after a partial rejoin` | Same fixture startup refusal. |
| `process: an in-place edit under an anonymous nested page replaces its retained copy` | Same fixture startup refusal. |

The shared refusal is `schema.q:51:16 — E_QUARRY_TYPE: cannot join list items
at field path [].id: a children reference and a reactions reference`.
This is the explicitly requested stricter reference join, so the fixture must
use an intentional common ID type while retaining its original provenance
assertions and wire values. No assertion in the provenance tests was relaxed.

Ran `scripts/test.sh` **exactly once**, exit **1**, with this exact summary:

```text
== 2 failure(s) in 1425 s
   cargo test
   client tests
```

All **78/78** seeded client models pass (**272 s**). Native/wasm builds,
docs budget, release guard, package build/typecheck, chat check, both app
typechecks and **9/9** fixture wrappers pass. The script's inherited 60-second
budget is exceeded; no timeout or budget was changed.

Post-suite corrections keep the executable narrowing example in the language
card and replace the duplicate types-card block with a pointer, preserving the
frozen authorization census. The scale expectation now includes that query.
The provenance fixture passes the two source IDs through `exposedId(value: id)`
before joining, retaining their wire values and source envelopes. The full run
also motivated a separate scoped probe for implicit shape snapshots: its new
regression fails before the fix and passes after. This completes the stable
field-path rule for `.n`, alongside named snapshots and aggregates.

The final qualification is the red full run at `174a155f3` plus **290/290**
affected checks of the corrections: compiler/guide **152**, authorization **81**,
scale **41**, provenance **16**. These qualify the final source at `74e4bb434`
(the next commit adds only this report and the journal). The full script was not repeated. No assigned
finding remains open; the unchanged optional-filter limitation above remains
outside the placement repair.
