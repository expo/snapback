# NL — named unique-key lookups, 2026-10-03

Exact named keys select points in any equality order. Both spellings require
provably non-null arguments on nullable columns of the selected unique key.
All changes are in the compiler, diagnostics, tests and docs; runtime code
and the wasm budget are unchanged. Work stayed on eb1000; nothing pushed.

Base: `9e41df69f36138fdd2570fbfd918b2b9d33294ad`; Round 0: `f5a05671ef`;
branch `sb4-intent/nl-named-key-lookup`.

## Semantics and code

| Case | Contract |
| --- | --- |
| Stored unique key contains null | Multiple rows remain legal. [`check_constraints`](../../crates/snapback4-core/src/engine/write.rs#L436) skips null-bearing collisions; device prediction uses the same interpreter. |
| Fully non-null key | Duplicate writes fail; a point reads the matching row, subject to authorization and device coverage. |
| Nullable selected key column, possibly null argument | Compilation refuses with `E_QUARRY_NULL_KEY`. A required argument type or presence guard admits the lookup. |
| Required key column, null argument | No row (false for `exists`): [`get_prepared`](../../crates/snapback4-core/src/engine/read_point.rs#L133). |
| Population `.col = arg`, null argument | Equality remains total: null equals null ([`BinaryOp::Eq`](../../crates/snapback4-core/src/engine/runner.rs#L1230)); a bounded population can return every visible null match. |
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

## Governing context

The `llp-orient` scope was lookup planning, null semantics and both stores:
[LLP 3000 §4](../../../llp/3000-snapback4.explainer.md#4-fence-numbering-routing)
sets the Snapback 4 fence; [LLP 3000.013 §§2.1–2.2](../../../llp/3000.013-quarry-states-intent.rfc.md#2-reads-state-intent)
governs point meaning and cursor totality; LLP 3000.007 §10 governs extra
named predicates. No remote machine or unrelated process was touched.
