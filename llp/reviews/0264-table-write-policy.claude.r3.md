# Confirming delta review (round 3): LLP 0264 — Table write policy

**Reviewer family:** Claude
**Provider / runtime:** claude-fable-5
**Date:** 2026-08-15
**Redacted:** no
**Method:** targeted confirming delta review; blind to the other family's
round-3 artifact. Inputs read: `llp/reviews/0264-table-write-policy.gpt-5.r2.md`,
`llp/reviews/0264-table-write-policy.claude.r2.md`, the round-3 section of
`REVISION-NOTES-0264.md`, and the revised Spec sections the six dispositions
touch (Scope absent semantics, D1, D3, D4, D8, D9, D10 precedence context,
Migration/Phase-1 acceptance, revision-history tables).
**Revision reviewed:** `llp/0264-table-write-policy.spec.md`, Revised
2026-08-15 (round-3 targeted response).

## Resolution of the six open round-2 items

| Item | Disposition | Reason |
| --- | --- | --- |
| GPT r2 MATERIAL 1 — HostPlan `no-effect` let later same-plan observation distinguish missing from not-owned | RESOLVED | The revision takes the taint alternative the finding offered: Scope now states the whole-plan contract explicitly ("every later observation of that target row inside the same plan sees the same canonical absent view"; "not a step-local promise", `llp/0264-table-write-policy.spec.md:135-138`), and D4 specifies the host-owned, plan-local identical-absent marker consulted before storage by every later `Get`, binding, `Guard`, `Let`/expression, point write, changed-count observation, document/record return, and copy resolving the target or a proven alias, with preflight refusing unprovable computed targets/aliases and the normalization running through the return value (`:319-330`). The specific shipped shapes the finding cited (fall-through `Patch`, unscoped `ReturnValue::Document`) are inside the enumeration. D8 now removes the contradiction the finding identified: the egress deferral "does not defer or weaken D4's narrower noninterference duty" (`:447-453`). Acceptance item 3 adds the composite post-check negative through `Get`, binding, expression/guard, copy/mixed step, changed count, and document return, plus the uncertain-alias preflight refusal (`:622-632`). Implementable: the marker is keyed on the canonical table/id, the mutation step vocabulary is closed, and `refuse` carriers terminate before later steps (`:330`). |
| GPT r2 MATERIAL 2 — conflict-disclosure authority could reach operation B without changing the D1 transition identity | RESOLVED | Each disclosure is now a canonical `{ table, writeForm, constraint, operations[] }` entry with sorted stable operation/entrypoint identities participating in the normalized body, digest, baseline, every ledger node, transition approval, both comparators, and the trusted runtime carrier (`:162-168`) — exactly the binding set the finding demanded. `operations[]` growth is classified as broadening, removal narrows only when no other write fact broadens, identity rebinds are incomparable, and "An approval for operation A therefore cannot authorize operation B merely because table, form, and constraint are equal" (`:170-179`). D3 requires the generated operation and the runtime carrier to name the same stable identity and be a member of `operations[]`, with aliases and caller input refusing (`:264-270`). Acceptance item 2 carries the A/B fixture including the widening classification and remotely prior approval on adding B (`:612-618`). |
| GPT r2 MATERIAL 3 — no representable opaque-JavaScript case in D9; D3 per-form gate under-specified | RESOLVED | The revision adopts the honest-operation-level-opacity alternative the finding offered: statically classifiable JavaScript sites stay per-site; otherwise exactly one operation-level `opaque` entry with `siteId: null`, `siteResolution: opaque-module`, `writeForm: opaque`, the closed v1 form ceiling, `declaredTableCeiling`, module path/digest evidence, and runtime-resolved sentinels for target-dependent facts (`:475-488`) — no fabricated site census, no collapse of exact rows. D3 pins the fail-closed gate: an unclassifiable operation refuses Phase-1 generation unless it declares `opaqueWritePosture: conservative-v1` with a closed table ceiling, under which every ceiling member is reachable through all three forms, every constraint from insert, and every field (hence every constraint) from patch, with disclosures covering the resulting census; a missing or opaque ceiling always refuses (`:272-289`). Phase 2 refuses every remaining opaque entry even when the Phase-1 declaration was valid (`:490-494`), and acceptance item 9 requires goldens for both refusal classes (`:647-654`). |
| Claude r2 MINOR 1 — opaque-refusal phase stated inconsistently between D3 and D9 | RESOLVED | The phase boundary is now pinned in one explicit paragraph ("Phase 1 admits an opaque JavaScript site only through D3's conservative posture… Phase 2 refuses every remaining `siteResolution: opaque-module` entry, including one that satisfied the Phase-1 conservative gate", `:490-494`) and repeated in the Phase-1 bullet list (`:592-595`). The reconciliation differs from the per-form asymmetry my r2 review inferred — all forms are admissible in Phase 1 under the conservative posture with full disclosure coverage — but it is a single coherent, explicitly stated rule, which is what the finding asked for. |
| Claude r2 MINOR 2 — identical-absent-bytes proof did not quantify over intermediate observers | RESOLVED | D4 now states the proof "ranges over every intermediate step which can observe the aliased binding and the complete public plan outcome, not only the prior read's direct error," and names the exact counterexample: an identical-byte `Get` followed by a divergent intermediate `Guard` is not composable (`:311-317`). Acceptance item 3 adds that exact negative fixture (`:625-627`). This is the requested sentence and fixture verbatim in substance. |
| Claude r2 MINOR 3 — pending reciprocal LLP 0234 amendment unrecorded | RESOLVED | Migration and rollout now opens with a "Cross-document obligation" subsection listing the pending LLP 0234 D5/D6 amendment — write posture in the shared body/digest/baseline/ledger/approval closure and comparators, operation-set identity and set-growth rule, projection pointer at D9 — required to land with Phase-1 implementation, while explicitly not amending or accepting on behalf of LLP 0234 (`:570-577`). The revision-history table records the disposition (`:773`). |

## New findings in the changed sections

1. **MINOR — D4's marker-consultation enumeration omits the two non-writer
   assert variants.** Scope's closed classification names
   `AssertCurrentRelation` and `AssertSourceChanged` as non-writer
   `MutationStep` variants (`llp/0264-table-write-policy.spec.md:111-115`),
   but D4's marker paragraph enumerates only "`Get`, binding, `Guard`,
   `Let`/expression, point write, changed-count observation, document or
   record return, and copy" as the later observations that consult the
   identical-absent marker (`:322-325`), and acceptance item 3's composite
   fixture mirrors that list (`:627-630`). An assert step that targets the
   checked row (or a proven alias) is an observer: asserting against the real
   not-owned row versus a missing row could yield divergent public failure for
   the two absent states. Scope's general whole-plan sentence ("every later
   observation of that target row", `:135-137`) covers asserts in spirit, but
   D4's list reads as the implementable enumeration, so an implementer could
   wire the marker into exactly the listed step classes and miss the asserts.
   **Suggested resolution:** one clause in D4 extending marker consultation to
   every step class that can resolve the target, naming the assert variants,
   and (optionally) an assert leg in the acceptance item 3 composite fixture.

No new MATERIAL concern was found in the changed sections. The marker
mechanism composes with D3's declared conflict-disclosure residual (a
same-plan insert probe against a hidden row discloses no more than the
already-governed constraint bit available without the checked write),
`DeleteWhere` cannot re-observe the hidden row because the owner predicate is
conjoined in-transaction (`:348-351`), and prior-read aliasing remains closed
by the widened composition proof.

## Assessment

All six round-2 open items are genuinely resolved with implementable,
internally consistent mechanisms that match the resolutions the round-2
reviews requested (or an explicitly offered alternative); the only residue is
one enumeration-completeness clarification with a one-clause fix.

VERDICT: READY
