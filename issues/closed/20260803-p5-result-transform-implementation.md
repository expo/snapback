# P5 — TransformPlanV1 implementation + conformance corpus

**Status:** Open (program: `20260803-local-first-continuation-program.md`;
parallel; gated)

Implement LLP 0166 §D7's `result-transform.v1`: the closed
TransformPlanV1 record, the fixed pipeline (base assembly → client-only
overlay → filter → order → limit) with the frozen total comparator, and
the dual-runtime (Rust + JS) reference implementation of the pure
transform with a golden corpus. FIRST: the corpus-home ruling — propose
the corpus as an LLP 0051 D5 extension to that owner (0157 OQ9); if
declined, a standalone corpus with pinned evaluator identities. Ship
gate unchanged: amendments are landed, but nothing evaluates until the
corpus passes on every claiming carrier AND a plan's owner reclassifies
it to `result-transform-snapshot-v1` (per-plan opt-in; identity
rotation per the 0157 amendment crosswalk). S6's post-gate legs are the
oracle. Rust half subject to the program's step-0 constraint.

## Resolution (2026-08-03)

Landed on main: dual-runtime TransformPlanV1 references
(`packages/snapback-client/result-transform.mjs` unexported + dormant,
`src/result_transform.rs`), the D5-extension corpus under
`tests/conformance/data-tier/result-transform-v1/` (56 pinned cases;
Rust-vs-JS 56/56 exact: 29 outputs, 27 typed refusals), and the
write-lane evidence receipt + verifier. The corpus-home ruling landed
first (extend D5 — LLP 0157 OQ9 + LLP 0051 dated notes, aeba33a8c).
Ship gate NOT fired: evaluation stays dormant until corpus success on
every claiming carrier, the S6 oracle legs, owner per-plan
reclassification (identity rotation + fresh establishment), and a
separate wiring change.
