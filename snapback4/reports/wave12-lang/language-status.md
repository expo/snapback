# Wave 12 language-lane status

Updated: 2026-10-15

## Outcome

The language production scope is frozen. All five semantic gaps are
implemented with no language-lane workaround or semantic deferral:

- ungrouped `view total: count t` is a hidden-row maintained scalar whose
  authorized empty value is zero and whose unauthorized value remains null;
- `require count(...) > 0` narrows only the exact current aggregate domain,
  and role guards narrow only the matching keyed total;
- `text format email` has one shared ASCII validation contract;
- enum columns use the existing word-search path;
- `divide` performs explicit-mode, integer-only exact rounded division,
  including the four-argument result-scale form needed for fractional integer
  averages without manual fixed-point multiplication.

LLP 3000.013.001 records the contract and remains linked from `llp/current/`.
The exact final language revision is the fifteen-commit digest
`47dbca97208e30ee42adcf574a69b30afd17d759d2f4c3499f1ba6df84a64694`.
Fresh, mutually blind Muse and Codex R7 reviews both returned **READY**.

## Commits

- `b081f96054` — email format contract
- `0fe7cc1263` — global totals, narrowing, enum search and rounded division
- `4156cdf7e5` — Lean, randomized difftest, simulator and device evidence
- `38bef8f6d8` — amendment, authoring guide and lane status
- `108c2aeeab` — stale-count/global-page/email review counterexamples
- `dcd85ffa57` — global scalar domain boundaries
- `b7aaba2716` — repaired and requalified guide cards
- `2254a60346` — extrema fallback and global contextual names
- `0cefbdb2ac` — normalized-global-only name reservation
- `5976cb9261` — stable builtin aggregate domains
- `5e280d9d39` — generated all-feature runtime/device parity families
- `01053b94db` — exact count-marker ownership and shared scan refusal
- `65ba4fe73f` — intentional multi-section guide lookup assertion
- `8ef64d411f` — schema rule/postcondition global-row refusal
- `be5d4a4b47` — lexical focal-row aggregate fact identity

The companion maintained-id/reopen implementation is `d516faac8a` and was
implemented and reviewed in its owning lane.

## Scoped verification

- Language semantics passed 7/7 before the final focal patch. The exact
  nested-focal counterexample and same-scope positive control pass 1/1 after
  `be5d4a4b47`. A subsequent full target compiled, then two runtime cases met
  a concurrent uncommitted core-lane legacy-identity cycle; the parent will
  rerun the frozen tree rather than treating shared dirty state as evidence.
- Maintained aggregates passed 15/15; rule/postcondition probe coverage passed
  5/5.
- The randomized rounded-division native/Lean/device difftest passed 1/1.
- Simulator coverage passed 1/1. Memory and SQLite device semantics plus
  strict old-decoder compatibility passed 2/2.
- The generated all-feature parity target passed 1/1. It covers eight public
  and eight role source families, 16 stale negatives and 16 fresh controls,
  with 264 server, 112 Memory and 112 SQLite outcomes through JSON decoding,
  paginated snapshots, stream updates and reopen.
- Lean passed 54 jobs, 65 axiom-audited theorems, 102 examples and 7 fixtures.
  Standalone witnesses cover global presence/disclosure, count/role narrowing,
  email validation and enum search; maintained/full-Unicode execution remains
  explicitly outside the row evaluator rather than being normalized to a pass.
- The full guide passed 123/123. Focused guide lookup and language operation
  class regressions pass.
- `ref-check --verbose` passes 547 LLP documents and 11,881 references with
  zero errors and zero unchecked references after the final amendment.

## Soundness decisions

- Count non-emptiness is a capture-time transaction fact. Writes, authority
  changes, joins, result/root rebinding, impure calls and self-dependent
  assignments cannot publish or borrow stale proof. Fact identity includes
  the guarded binding's runtime/revision and the exact domain.
- A focal key/seek owns the enclosing lexical row snapshot. Aggregate-filter
  dots use a separate candidate-domain token, so an outer Alice proof cannot
  narrow an inner Bob extremum.
- Global scalar physical rows are compiler-private. Shared program scan and
  schema probe admission reject direct, wrapped, planned, aggregate, loop,
  rule and postcondition access while preserving the bare scalar read.
- Hidden maintained misses remain null. Zero is returned only after the
  matching authorization proof.
- Rounded division uses checked `i128` scale arithmetic, signed quotient and
  remainder, explicit `toward-zero`, `floor`, `ceil`, `half-away` or
  `half-even` behavior, and an i53 result bound. Null propagates; zero divisor,
  invalid scale/type and overflow refuse; no floating point is used.

## Endgame ownership

No further production edits are planned in this lane. The parent orchestrator
owns the final clean full-five-crate run, complete difftest/census campaigns,
wasm qualification and any coordination required to clear unrelated shared
core edits. No push was performed.
