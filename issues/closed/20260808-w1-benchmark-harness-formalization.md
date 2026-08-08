# Formalize the W1 measurement harness under benchmarks/

**Status:** Closed (2026-08-08)
**Impact:** 3
**Urgency:** 3
**Ease:** 3
**Confidence:** 5
**Systems:** Competitive evaluation, Testing, Documentation
**Date:** 2026-08-08
**Related:** Diary 0068; Diary 0066; `benchmarks/` (the delivered instrument)

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

- **Claimed 2026-08-08:** session 86767887 (the diary-0068 orchestrator) is executing this ticket now; sibling sessions should not duplicate.

## Resolution (2026-08-08)

Delivered under `benchmarks/`: a methodology README with the complete run
procedure and the skill-payload/registry-lag note; a four-brief corpus
(messaging verbatim plus its proof list, the equal-proof-bar variant, CRUD,
and media — CRUD and media were already scaffolded on 2026-08-06); four lane
prompt templates carried verbatim from the diary-0068 run; and `records/`
with the record format and the npm 0.1.13 standing baseline, including the
full 0058/0065/0066/0068 series.

The JSON Schema now records `laneVariant`, `carrier`, `toolUses`, and the
equal-proof-bar brief. The former `calibration/` role is folded into
`records/`. `protocol.md` records the N>=3 ratchet-claim floor while LLP 0186
OQ2 continues to own the calibrated answer. LLP 0186's Sequencing and
ownership section now carries the one-line W1 instrument pointer.

The acceptance criterion is met: a fresh orchestrating agent can run the
comparison from `benchmarks/` alone by following the README procedure. The
wish that repeat runs become one command is not delivered; it remains open
harness work under LLP 0186 OQ2.
