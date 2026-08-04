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
