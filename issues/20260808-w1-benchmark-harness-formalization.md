# Formalize the W1 measurement harness under benchmarks/

**Status:** Open
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Competitive evaluation, Testing, Documentation
**Date:** 2026-08-08
**Related:** Diary 0068; Diary 0066

Four measurement runs (diaries 0058, 0065, 0066, 0068) have converged a
working methodology that lives only in diary prose and session memory:
cold-context lanes, published-surfaces-only fence, verbatim brief, serial
same-machine execution, harness token metering, per-lane report format,
skill-payload extraction from a scaffold, and the ratchet-series table.
LLP 0186 W1 owns this; commission the committed form:

- `benchmarks/` directory: the brief corpus (messaging verbatim from
  0058; add CRUD and media briefs), the lane prompt templates (bare /
  skill / native / competitor), the fairness rules, and the run-record
  schema (wall, tokens, loops, proof results, basis).
- The standing baselines from diary 0068 (skill-web 1.59x wall / 2.00x
  tokens vs Convex) recorded as the current series entry.
- An equal-proof-bar brief variant (both lanes must prove identical
  offline semantics) — the asymmetry where Convex's number worsens as
  the bar rises is the most defensible published comparison.
- Note OQ2 (LLP 0186): ratchet claims need N>=3 runs per config; the
  harness should make repeat runs one command for an orchestrating agent.

Acceptance: a fresh orchestrating agent can execute a full run from
benchmarks/ alone, producing a comparable run record, without reading any
diary.
