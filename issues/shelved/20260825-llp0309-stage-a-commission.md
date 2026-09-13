# Commission LLP 0309 Stages A+B — operator delta semantics, reference evaluator, re-derivation audit

**Opened:** 2026-08-25
**Authority:** author direction (Charlie Cheever, 2026-08-25), firing
LLP 0309 §D5 commissioning trigger (a): the delta-lane ladder is
intended to continue past G3 rung 1, so the per-operator semantics
amortizes across the remaining rungs instead of competing with a
single hand-written one.

## Scope

Per LLP 0309 (Accepted 2026-08-25):

1. **Stage A** — the normative operator semantics as sub-Spec
   `llp/0309.000-operator-delta-semantics.spec.md` (D1.1 carrier
   contract instantiated per operator; D1.2 classification hypotheses
   confirmed or corrected against the shipped IR and evaluator; D1.3
   state ledgers judged against both precedents — the capture
   vocabulary and the G3 retained state — with custody classes; the
   closure check over every `GraphNodeV1` variant and
   `TableVisibilityV1` arm), plus the **executable reference
   evaluator** over the delta carriers and the **per-operator
   conformance vector corpus** in the house `tests/conformance/`
   pattern. No production runtime change.
2. **Stage B** — the §D4.2 re-derivation audit: shipped lanes (DK-3
   single-table classification, G3 rung 1 graph delta lanes) compared
   against the reference evaluator on existing corpora and replay
   fixtures across all §D4.2 oracle axes, each divergence classified
   (a) reference error / (b) shipped defect → fix-forward ticket /
   (c) recorded conservative approximation. Stage B changes no
   runtime code. Unclassified divergence blocks Stage C.

**Not commissioned here:** any Stage C rung (each remains
individually demand-gated per LLP 0209 §7); Stage D (conditional on
LLP 0190 D3); the replica continuity contract (LLP 0209 OQ-6).

## Plan of record

1. Author `0309.000` (Draft), spec-first. Author ruling on OQ-1:
   sub-Spec of 0309.
2. `/llp-super-refine` the spec to dual-family READY (LLP 0010.001
   loop; sealed records under `llp/reviews/`).
3. Implement Stages A (reference evaluator + vectors) and B (audit)
   via `/sbs-orchestrate` (codex gpt-5.6-sol implementation; codex +
   grok-4.6 xhigh review), landing per LLP 0232 optimistic-landing
   and LLP 0189 verification cadence.

## Exit criteria

- `0309.000` dual-family READY and Accepted by the author.
- Reference evaluator + vector corpus landed and green in the local
  proof; vectors cover every admitted operator form including
  FALLBACK verdicts and three-valued-logic/boundary edges.
- Stage B audit report recorded with every divergence classified;
  class (b) findings filed as fix-forward tickets.
- LLP 0209 §7 cross-reference updated to name `0309.000` as the
  provenance of future rung rule content (Stage C posture).

## Log

- 2026-08-25 — Opened. RFC 0309 Accepted, OQ-1 ruled (sub-Spec),
  trigger (a) fired, all by author direction in the same session.
- 2026-08-25 — Plan step 1 done: `0309.000` authored (r1 grounded
  in a three-way code inventory at `232a82504`).
- 2026-08-25 — Plan step 2 done: super-refine **CONVERGED
  dual-READY on r6** (content hash `e65ea68f33cb02ef`, commit
  `a15eda9c0`; 6 rounds, 6/6 launches per family, freeze held from
  r3; records `llp/reviews/0309.000-operator-delta-semantics.*`).
  r7 = unreviewed obligation-register bookkeeping. Spec stays
  `Review` pending author acceptance. Proceeding to plan step 3
  (implementation via /sbs-orchestrate).
- 2026-08-26 — **Stage A LANDED on main** (lane tip `9b9ab5f4a`):
  reference evaluator crate `tools/snapback-delta-semantics`
  (serving-path-isolated, dev-dependency of the corpus runner only)
  + 128-vector corpus `tests/conformance/delta-semantics-v1/` +
  runner `delta_semantics_corpus_v1.rs`. Implemented codex
  gpt-5.6-sol @ xhigh; dual review-gated (codex + grok @ xhigh)
  through five review rounds and four fix rounds (12 → 3 → 5 → 2 →
  1 findings); final round grok CLEAN, codex's one finding was a
  spec-side formula artifact folded as the r8 UNREVIEWED
  correction. Stage B (audit) is the remaining deliverable.
- 2026-08-26 — **Stage B LANDED on main** (`5e32021a5` +
  regeneration `5d05450da`): audit harness
  `delta_semantics_stage_b_audit_v1.rs` + fixture adapter, report
  `llp/0309.001-stage-b-audit.research.md` — **17 divergences: 0
  class (a), 2 class (b) (tickets
  `20260826-graph-delta-projection-custody-leak`,
  `20260826-graph-exec-disabled-established-delta-bypass`), 15
  class (c), 0 unclassified; 12-item honest gap register. Stage C
  is unblocked** per the D4.2 decision rule. Three disclosed
  read-only test-support hooks; no runtime behavior change. Dual
  review-gated over 5 rounds (4 fix rounds; final: grok CLEAN,
  codex CLEAN on finding-owner verification).
- 2026-08-26 — Exit criteria: evaluator+corpus landed/green ✓;
  Stage B report recorded, all divergences classified, class-(b)
  tickets filed ✓; LLP 0209 §7 provenance cross-reference added ✓;
  spec dual-READY ✓ — **author acceptance ruling still pending**
  (the one open exit item; the loop record recommends Accepted).
  **Ticket closes when the author rules on acceptance.**
