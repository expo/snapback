# NL — named unique-key lookups, 2026-10-03

Exact named keys select points in any equality order. Both spellings require
provably non-null arguments on nullable columns of the selected unique key.
All changes are in the compiler, diagnostics, tests and docs; runtime code
and the wasm budget are unchanged. Work stayed on eb1000; nothing pushed.

Base: `9e41df69f36138fdd2570fbfd918b2b9d33294ad`; Round 0: `f5a05671ef`;
Round 1: `42391bb340`; Round 2: `cbb4a56fb4`; Round 3: `065e1faa86`;
Round 4: `1bed2b74d4`; Round 5: `c25aa1b2dc`;
branch `sb4-intent/nl-named-key-lookup`.

## Semantics and code

| Case | Contract |
| --- | --- |
| Stored unique key contains null | Multiple rows remain legal. [`check_constraints`](../../crates/snapback4-core/src/engine/write.rs#L436) skips null-bearing collisions; device prediction uses the same interpreter. |
| Fully non-null unique key | Duplicate writes fail; a point reads the matching row, subject to authorization and device coverage. |
| Nullable selected key column, possibly null argument | Compilation refuses with `E_QUARRY_NULL_KEY`. A required argument type or presence guard admits the lookup. |
| Required key column, null argument | No row (false for `exists`): [`get_prepared`](../../crates/snapback4-core/src/engine/read_point.rs#L133). |
| Population `.col = arg`, null argument | Equality remains total: null equals null ([`BinaryOp::Eq`](../../crates/snapback4-core/src/engine/runner.rs#L1230)); a bounded population can return every visible null match. |
| Nonunique point probe | `E_QUARRY_POINT_KEY` refuses. A fully pinned superset of a required unique key is unique too; otherwise use population `exists` in code. |
| Maintained aggregate null group | Unchanged; it addresses a maintained group, exempt from the point refusal. |

The original first-candidate interpretation was **not a shared host contract**.
Physical keys append id ([`index_key`](../../crates/snapback4-core/src/rows.rs#L146)).
Server/SQLite [`lookup`](../../crates/snapback4-core/src/store.rs#L510) and device
memory [`lookup`](../../crates/snapback4-device/src/memory.rs#L588) each take
one candidate from their own store; [`authorized_point`](../../crates/snapback4-core/src/engine/authorized_point.rs#L182)
then checks that candidate alone. A replica can hold a different subset:
with null ties owned by alice, bob and carol, bob's server could reject
alice's candidate while bob's device selected bob's row. Round 1 refuses
such source programs rather than changing storage or raw-IR execution.

[`Requests::read`](../../crates/snapback4-lang/src/bind/intent.rs) recognizes
exact plain unique keys. With the same selected index and no residual
equalities, both spellings lower to the same `Get`/`Exists` key in declared
column order (expression setup retains authored evaluation order). A shorter
total unique key can win for named equalities: `single: low` plus a residual
`high` comparison, versus positional `pair: low, high`. Admitted arguments
return the same row through these different plans.

## Round 0 verification

The copied calibration #29 schema, windows and push worker reproduced
`E_QUARRY_BOUND` at `schema.q:206:10`, suggesting `cap N by high, low`.
After the fix its named form checked: 29 tables, 53 operations, 24 existing
notes. All 203 affected tests passed. The final full suite passed in 1,391 s
(an earlier run exposed the aggregate repair regression, subsequently fixed).
Clients: 6,034 passed, 11 skips; models: 79 passed. Logs:
`/tmp/sb4-nl-verification/`. First-null-candidate tests and claims from this
round are superseded by the operator's Round 1 decision below.

## Round 1

- Applied the operator's compile-time null rule in shared
  [`point_key::check`](../../crates/snapback4-lang/src/bind/point_key.rs),
  called by program reads, `exists`, keyed writes and rule/`created` probes.
  Rule binding carries presence facts along short-circuit branches, including
  `not` and old/next transition terms. Focal shape rows now register as lexical
  snapshots so their field guards also narrow key arguments. Rewrites name guards, a bounded
  `where … by .id` population, or row id; null groups remain unchanged.
- Fixed Astra P2: [program selection](../../crates/snapback4-lang/src/bind/program.rs)
  and [rule selection](../../crates/snapback4-lang/src/bind/schema.rs) retain
  an exact unique key ahead of competing nonunique indexes while preserving
  shorter-total-key precedence. An unguarded nullable rule now gets the null
  diagnostic, never the competing-index ambiguity.
- Fixed Grok Medium: [repair verification](../../crates/snapback4-lang/src/repair.rs)
  requires `by .id` for exact nullable unique populations even if a bare point
  would compile. A shape with a cap retains both tied rows `a` and `m`; an
  unbounded shape offers no unchecked repair. A guarded shape regression
  proves this even when the bare point compiles and executes the repaired page.
  Already bounded populations retain their valid page repair.
- Qualified plan identity (Astra P3/Grok Low) and corrected the indexes guide,
  LLP 3000.013 §2.2, ticket resolution and this report. The append-only journal
  records the supersession of Round 0's first-candidate interpretation.
- [Lookup regressions](../../crates/snapback4-device/tests/named_key_lookup.rs)
  cover both device stores and server, all two/three-column permutations and
  optional-column masks, null/non-null inputs, static presence and guards,
  literal null refusal, competing indexes, rule branches, shorter total keys,
  private null populations, maintained null groups, partial-key bounds,
  nullable writes, and calibration #29's non-null sorted principal keys.

- **318 affected tests pass** (218 language, 32 core disclosure, 68 device),
  including 14 verified repairs and shape/control-flow coverage. The full
  run exposed legacy fixture probes now correctly refused: nullable private
  values in disclosure rules now have guards, and timeline foreign reads
  address the same row by its engine-defined id. Privacy assertions remain
  intact; the complete core/device disclosure matrices and timeline tests pass.
  Logs: `/tmp/sb4-nl-r1-verification/affected-*.log`.
- The complete suite's locked wasm build is byte-identical to Round 0: **2,048,676 B
  raw / 617,398 B gzip**, budget **618,040 B**, headroom **642 B**.
  SHA-256: `09dd6a9e2619d50b2059e78d8abedfce99239b9ea27dfe6c088d856c5ef8ce3f`.
- Two in-progress full runs were superseded after the focal-field guard
  finding and the legacy fixture refusals. Only owned suite processes and
  their own children were signaled; their temporary fixture directories were
  removed.
- **Full suite: zero failures in 1,397 seconds**, using
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
  Rust passed in 449 s; clients: **6,034 passed, 11 existing skips** (595 s);
  serial models: **79 passed** (309 s). Log: `full-suite-complete.log` under
  `/tmp/sb4-nl-r1-verification/`.
- After the final already-bounded-repair adjustment, repeated the **complete
  Rust inventory on the final code**: 288 binaries, 1,001 executions and
  workspace doctests, all passing. Six workers reserved capacity for the
  concurrent client run; counts and assertions were unchanged.
  Log: `final-rust-inventory.log` in the same directory.
- `ref-check --verbose`: 527 LLPs, 10,287 refs, zero errors or unchecked refs.
  Whitespace checks pass. No runtime source or wasm-budget change.

## Round 2

- **The nonunique `exists` split predates NL.** On Round 1's head, null
  and non-null ties with a hidden first row returned complete `false` on the
  server and complete `true` on both devices. The explicit-index Exists-mode
  selection already exists at `9e41df69f3`; the four lookup/witness/store files
  above have no diff from that base. Reproduction source and output:
  `/tmp/sb4-nl-r2-verification/baseline-probe-executed.rs`, `baseline-split.log`;
  historical comparison: `pre-nl-exists-selection.txt`, `pre-nl-runtime.diff`.
- Chose **compile-time refusal**, not new point-runtime search semantics.
  This preserves the point contract and reuses the population path's existing
  bounds and meters rather than introducing a second search contract.
  [`point_key::check`](../../crates/snapback4-lang/src/bind/point_key.rs) now
  requires uniqueness for code/rule probes, `created` and final-insert probes.
  Required unique subsets prove a fully pinned larger key unique, preserving
  existing role checks. Explicit nonunique nullable inverses still refuse:
  select the unique key and prove nullable arguments present. Existing
  population `exists` keeps its bounded search and unavailable result on cuts.
  Unqualified named predicates can already plan as bounded populations;
  the new admission check governs point probes, including explicit `by`.
- [`intent_lanes`](../../crates/snapback4-lang/src/bind/intent_lanes.rs) retains
  the authored predicate as compiler-only admission evidence. Before emitting
  a proposed lane, [`planned_view`](../../crates/snapback4-lang/src/bind/program/views.rs)
  binds that predicate in the caller's original scope. Literal-null probes
  cannot disappear, including inside views. [`row_predicate`](../../crates/snapback4-lang/src/bind/program/reads.rs)
  supplies a scoped focal binding, so `and`/`or` guards narrow row fields.
- Point diagnostics retain recovery guidance but emit **no unverified source
  edit**. Page planning excludes fully pinned nonunique indexes and supplies
  an unpinned id component. The competing-index population now compiles.
  LLP §2.2 and the ticket distinguish retaining an existing valid page repair
  from trying `by .id` for an otherwise bare nullable key.
- [New regressions](../../crates/snapback4-device/tests/point_probe_admission.rs)
  cover null/non-null ties with hidden first candidates, both device stores,
  positional/named/reordered code and rule probes, final-insert probes,
  planner erasure, direct and planned-view guards, scope isolation, required
  unique subsets, and population alternatives. The original arity/permutation
  matrix and calibration #29 continue passing.
- Legacy fixtures now declare unique witnesses, or enumerate two witnesses
  through unique slots. Physical-store privacy tests retain deliberately
  injected historical ties and all their meter/deadline assertions. One old
  ambiguous expiry assertion now pins refusal. The frozen tests explicitly
  pin the refused `repair-probe.q` and four historical lowering operations;
  all still-admitted schema, TypeScript and IR bytes retain their old goldens.
- **Affected checks pass:** 303 language tests, the 25-test lookup/admission
  matrix, and the affected privacy, expiry, lowering, CLI and client fixtures.
  Both newly refused client fixtures retain their original queueing/expiry
  assertions through explicit unique keys or slots.
- The locked wasm build is still byte-identical: **2,048,676 B raw / 617,398 B
  gzip**, **642 B** below the unchanged **618,040 B** budget, with the same
  SHA-256 recorded in Round 1. Reference validation: 527 LLPs, 10,289 refs,
  zero errors or unchecked refs. Whitespace checks pass.
- **Full suite: zero failures in 1,466 seconds**, using
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
  Rust: **289 binaries, 1,002 executions and workspace doctests** (525 s).
  Clients: **6,034 passed, 11 existing skips** (592 s); serial models:
  **79 passed** (305 s). Final log: `full-suite-complete.log` under
  `/tmp/sb4-nl-r2-verification/`. Earlier runs exposed legacy fixtures,
  including two client cases; their affected reruns pass. Only owned processes
  were stopped. No other machine, push, or publication was used.

## Round 3 (2026-10-04)

- Fixed Astra P2's maintained-group regression in
  [`point_key::check`](../../crates/snapback4-lang/src/bind/point_key.rs): a key
  covering the generated `byGroup` columns establishes one maintained group,
  including null, before ordinary-table uniqueness admission. A secondary
  index with an extra value predicate keeps that proof. Partial groups and
  value-only probes spanning groups still refuse.
- Fixed Astra P2's index-mismatch advice in
  [`index_mismatch`](../../crates/snapback4-lang/src/bind/program/diagnostics.rs):
  alternative point indexes pass the same uniqueness and presence checks.
  Required unique supersets and guarded nullable keys remain valid repairs;
  planner tokens that cannot be pasted as authored index names are withheld.
  The same admission check covers fully pinned ranges suggesting a point.
  Point mismatches without a valid alternative emit no source template.
  Regression tests paste each offered read into its original source and compile it.
- [Maintained-group regressions](../../crates/snapback4-device/tests/point_probe_admission.rs)
  compare server rule verdicts with server/memory/SQLite code probes over held
  public inputs: nullable one/two-column groups, null/non-null and literal-null
  arguments, reordered equalities, matching and mismatching values. The
  aggregate-dependent rule has no invertible sync audience and remains online
  only; devices evaluate the equivalent code probe. Partial-group controls refuse.
- **282 affected language tests and 28 lookup/admission tests pass**, with four
  existing aggregate-suite ignores. The guide and LLP §2.2 now make the full-group
  condition explicit. Production runtime code and the wasm budget are unchanged.
- Both exact review sources were also checked with the rebuilt CLI: the
  maintained rule compiles, and the mismatched nonunique probe offers no rewrite.
- Wasm remains byte-identical: **2,048,676 B raw / 617,398 B gzip**, **642 B**
  below the unchanged **618,040 B** budget, with the Round 1 SHA-256.
  Reference validation: 527 LLPs, 10,290 refs, zero errors or unchecked refs.
- **Full suite: zero failures in 1,533 seconds**, using
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
  All **289 Rust binaries, 1,002 executions and workspace doctests** passed
  (569 s); clients: **6,034 passed, 11 existing skips** (600 s); serial models:
  **79 passed** (320 s). Final log: `full-suite-complete.log` under
  `/tmp/sb4-nl-r3-verification/`. Only eb1000 was used; nothing pushed.

## Round 4 (2026-10-04)

- Index mismatch (point/range) and program/rule ambiguity now submit compiler-only
  candidates to the existing [repair verifier](../../crates/snapback4-lang/src/repair.rs).
  The verifier uses the caller's recorded read and operands, reparses the patched
  declaration, and binds it with the original project. Helpers' callers and job
  chunk contracts participate. Candidate diagnostics never recursively trigger
  verification; only a clean result exposes source in `rewrite`.
- Removed the range fallback that invented argument names from index columns and
  the invalid job chunk sketches. Guidance stays in the message; an offered
  rewrite is only the replacement read. Ambiguous nullable points offer nothing
  unless their guards/types prove admission. Required/guarded alternatives remain.
  `E_QUARRY_NULL_KEY`, `E_QUARRY_POINT_KEY` and runtime admission are unchanged.
- [Paste-and-compile regressions](../../crates/snapback4-lang/tests/verified_index_repairs.rs)
  cover both equality orders, reads/exists/created, program/rule/job ambiguity,
  point/range mismatches, required/optional job domains, cursors and filters,
  grouped/Unicode/commented operands, helper callers in other files, and remaining
  context errors. A range-to-point repair is withheld when a caller needs a page.
  Multiple errors may conservatively withhold all source edits; prose remains.
- **218 affected language tests and 28 lookup/admission tests pass**, no ignores.
  The guide and LLP §2.2 state the verification contract. Reference validation:
  527 LLPs, 10,291 refs, zero errors or unchecked references.
- The rebuilt CLI also confirms empty rewrites for the three reported forms:
  unguarded nullable ambiguity, the wrong-typed range, and the fully pinned job.
- Wasm is byte-identical: **2,048,676 B raw / 617,398 B gzip**, **642 B** below
  the unchanged **618,040 B** budget, with the Round 1 SHA-256.
- **Full suite: zero failures in 1,491 seconds**, using
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
  Rust: **290 binaries, 1,003 executions and workspace doctests** (542 s);
  clients: **6,034 passed, 11 existing skips** (594 s); serial models:
  **79 passed** (304 s). Final log: `/tmp/sb4-nl-r4-verification/full-suite.log`.
  Work stayed on eb1000; nothing pushed.

## Round 5 (2026-10-04)

- Restored verified index repairs inside instantiated named shapes and writing
  helpers. Index diagnostics originate while binding an actual caller; the
  verifier retains those callers, including their focal types, mutation mode,
  nested expansions and uses in other files. It no longer rejects a shape
  before checking callers or adds a synthetic query to a mutation helper.
- Declaration-local parser repairs still probe otherwise unchecked helpers.
  The fallback query uses the compiler-only `$repair:` namespace, which cannot
  collide with authored operation names such as `repairProbe` or module names.
  Uninstantiated shapes on that local path still have no focal proof.
- All three reported suppression cases failed as new regressions before the
  fix. Paste-and-compile tests now cover shape reads and `exists` in either
  equality order, direct and nested spreads, writing helpers through direct,
  nested and cross-file calls, and the user operation name collision. Mixed
  callers with a nullable focal type or an illegal query write still withhold
  repairs. Tests also exercise the no-caller fallback and its reserved name.
  All Round-4 invalid-rewrite regressions remain passing; point admission and
  runtime behavior are unchanged.
- **224 affected language tests and 28 lookup/admission tests pass**, no ignores.
  Logs: `/tmp/sb4-nl-r5-verification/affected-{lang,device}.log`.
- **Full suite: zero failures in 1,442 seconds**, using
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
  Rust: **290 binaries, 1,003 executions and workspace doctests** (495 s);
  clients: **6,034 passed, 11 existing skips** (597 s); serial models:
  **79 passed** (305 s). Log: `/tmp/sb4-nl-r5-verification/full-suite.log`.
- Wasm is byte-identical to Round 4: **2,048,676 B raw / 617,398 B gzip**,
  **642 B** below the unchanged **618,040 B** budget; SHA-256
  `09dd6a9e2619d50b2059e78d8abedfce99239b9ea27dfe6c088d856c5ef8ce3f`.
  Measurement: `/tmp/sb4-nl-r5-verification/wasm.json`.
- Reference validation and whitespace checks pass. Work stayed on eb1000;
  no unrelated process was signaled, and nothing was pushed.

## Round 6 (2026-10-04)

- Fixed Grok's older positional unique-key diagnostic in both program reads
  and rule probes. Instead of offering a named key that can remain ambiguous,
  each declared candidate now submits an explicit index choice to the same
  in-context verifier as named ambiguity. The caller's positional operands
  stay intact. Only a compiling candidate becomes source; no admitted choice
  means an empty rewrite. `E_QUARRY_POSITIONAL_SCAN` remains non-mechanical:
  index choice can change what each positional argument means.
- Three new regressions failed before the fix and pass afterwards. Verbatim
  paste tests cover point reads, `exists` and rule `created`, both argument
  orders, required/optional arguments and guards, literal nulls, a rejected
  first candidate followed by a valid `inverse`, comments/grouping, incompatible
  types and missing arities. Previous withheld-rewrite regressions remain green.
  Point admission, plans for accepted programs and runtime behavior are unchanged.
- Grok's Low #2 (`repairProbe` collision) was already fixed in Round 5.
  Its integration regression and fallback-probe unit tests pass again here.
- **260 affected language, 28 lookup/admission and 27 CLI repair tests pass**,
  no ignores. Logs: `/tmp/sb4-nl-r6-verification/affected-{lang,device,cli}.log`.
  The guide and LLP §2.2 now explain why opposite index orders need an explicit
  choice and why suggestions must compile in the caller's context.
- **Full suite: zero failures in 1,413 seconds**, using
  `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT bash snapback4/scripts/test.sh`.
  Rust: **290 binaries, 1,003 executions and workspace doctests** (469 s);
  clients: **6,034 passed, 11 existing skips** (591 s); serial models:
  **79 passed** (308 s). Log: `/tmp/sb4-nl-r6-verification/full-suite.log`.
- Wasm is byte-identical to Round 5: **2,048,676 B raw / 617,398 B gzip**,
  **642 B** below the unchanged **618,040 B** budget; SHA-256
  `09dd6a9e2619d50b2059e78d8abedfce99239b9ea27dfe6c088d856c5ef8ce3f`.
  Measurement: `/tmp/sb4-nl-r6-verification/wasm.json`.
- Reference validation and whitespace checks pass. Work stayed on eb1000;
  no unrelated process was signaled, and nothing was pushed.

## Governing context

The `llp-orient` scope was lookup planning, null semantics, source repairs and both stores:
[LLP 3000 §4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
sets the Snapback 4 fence; [LLP 3000.013 §§2.1–2.2](../../../llp/3000.013-quarry-states-intent.rfc.md#2-reads-state-intent)
governs point meaning, cursor totality and verified index advice; its §13.5
records the existing repair-verification contract. LLP 3000.007 §10 governs extra
named predicates. No remote machine or unrelated process was touched.
