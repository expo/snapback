# Delta-semantics v1 conformance corpus

This is the executable vector corpus for LLP 0309.000 §7.2. Each numbered
case is data only: one operator, its reference state, one folded input batch,
the bounded read transcript `R`, and the exact maintain/state or fallback
verdict.

`corpus-source.mjs` is the source of truth for case inputs and frozen
expectations. `cargo test -p snapback --test delta_semantics_corpus_v1` runs
each case twice, compares exact JSON bytes, checks every case hash and schema,
and verifies that all thirteen fallback reasons occur. Set
`SNAPBACK_FREEZE_DELTA_SEMANTICS=1` only after inspecting evaluator changes to
refresh expected outcomes and the manifest; then use the source script's
`--adopt-frozen-expectations` and `--write` modes to make the authored source
reproduce the frozen corpus exactly.
