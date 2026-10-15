# Wave 12 diagnostics status

Updated: 2026-10-15

## Outcome

Wave 12's paste-ready compiler rewrites are applied to their authored fixture
and compiled again. The boundary is explicit: `Diagnostic::source_rewrite`
is exact replacement text; `Diagnostic::rewrite` also carries explanations,
alternatives and guide commands that are intentionally not a single source
edit.

The concrete-source golden is
`wave9_rule_diagnostic_rewrites::every_concrete_rule_rewrite_is_the_emitted_text_and_compiles_in_its_schema`.
Its `classified` helper exhaustively matches the four current
`SourceRewriteKind` values, so adding a category fails compilation until the
match is extended. The test target collectively exercises every current
emitter:

- `MixedKey`: the emitted named-key read is applied and compiled; an
  independent truth table checks absent and present membership.
- `NamedUpdate`: emitted rules bind `(old, next)`, retain explicit `old` and
  `next`, rewrite an unqualified `.field` to `next.field`, leave a quoted
  `'.field'` unchanged and preserve underscore-prefixed fields. Every emitted
  line is applied and compiled; the old/next status truth table also runs.
- `WriteResultNarrowing`: both nullable id and nullable row forms are applied
  and compiled.
- `MembershipBootstrap`: the emitted insert rule is applied and compiled, and
  the complete bootstrap snippet is compiled separately.

This is exhaustive by source-rewrite category and current emitter site. It is
not a registry of every prose `rewrite` string; adding another emitter under an
existing category still requires its own fixture.

## Other repaired diagnostics

- `wave12_diagnostics::sql_habits_name_quarry_order_and_emit_compiling_rewrites`
  applies and recompiles the emitted `count(table where ...)`, `first ... desc`
  and `last ... desc` repairs.
- `wave12_diagnostics::multiline_require_rewrite_preserves_the_authored_refusal_code`
  extracts the emitted one-line `require`, preserves the authored `else` code,
  applies it and recompiles.
- `wave12_diagnostics::structural_fanout_leads_with_a_direct_viewer_predicate`
  extracts the exact leading `.member = viewer` predicate, adds it before the
  authored filter and recompiles. Separate tests apply and execute the count
  view alternative and compile the point-read alternative.
- `page4::equality_filter_note_prints_one_matching_index_and_query` extracts
  the exact emitted fenced query, adds its asserted matching index declaration,
  recompiles and verifies the incompleteness note disappears. Oversize and
  keyed-read controls verify that unsafe advice is withheld.

## Evidence and commits

The last integrated full-six receipt is
`reports/wave12-lang/full-six-reconciliation.json`: `page4` passed 18/18,
`wave12_diagnostics` passed 12/12 and
`wave9_rule_diagnostic_rewrites` passed 8/8. The added direct-viewer application
does not add a test case, so the target remains 12 tests; its focused rerun is
recorded separately by the integration owner.

Relevant checkpoints are:

- `4433843552` — reserve project builtins and reject repeated identity use;
- `35a4871189` — implement the Wave 12 diagnostic repairs and initial fixtures;
- `467d2b4a72` — complete SQL, fanout and cascade-guidance coverage;
- `4dbf2ffc8e`, `5447e593d0`, `2369bee89c`, `dda0bbdc91` and
  `96035cf0b7` — add and refine the equality-filter index and exact-query
  advice, including fit and keyed-read refusal controls;
- `c9a50c89f2` — preserve the paired diagnostics review record.
