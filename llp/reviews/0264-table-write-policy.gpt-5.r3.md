**Reviewer family:** GPT
**Provider / runtime:** OpenAI Codex / gpt-5.6-sol
**Reasoning effort:** xhigh
**Date:** 2026-08-15
**Redacted:** no
**Method:** manual, independent fresh-session targeted delta review
**Revision reviewed:** `llp/0264-table-write-policy.spec.md` working-tree blob `6a792ccc32423ed69e3e2bcd970ece1ba7c82ebd` based on repository commit `6af92793517e5b688337f4914fa8bf7a15c50065` (round-3 targeted revision)

## Overall assessment

The round-3 revision genuinely resolves all six requested items. Each security
claim now has a normative carrier or fail-closed rule, an explicit phase or
cross-document boundary where applicable, and a corresponding acceptance
fixture. The changed sections introduce no new material concern.

## Round-2 finding resolution

| Finding | Implementable mechanism | Assessment |
| --- | --- | --- |
| GPT r2 1 — plan-wide HostPlan `no-effect` non-disclosure | Absent semantics is now expressly whole-plan. D4 records a host-owned identical-absent marker before continuing, requires every later same-target or proven-alias read, binding, guard/expression, point write, count, copy, and return to consult it before storage, carries normalization through the final outcome, and refuses uncertain aliases at preflight. The composite fixture checks identical results and companion effects (`llp/0264-table-write-policy.spec.md:128-138`, `:319-330`, `:621-632`). | **RESOLVED.** The mechanism closes both the original later-read/return oracle and intermediate effect/branch observations while remaining implementable as a transaction-local target overlay plus conservative alias refusal. |
| GPT r2 2 — conflict-disclosure authority absent from per-operation transition identity | D1 canonicalizes each disclosure as `{ table, writeForm, constraint, operations[] }`; the sorted stable operation identities are included in the policy body/digest, baseline, every ledger node, approvals, comparators, and trusted runtime carrier. Set growth is broadening, identity rebinds are incomparable, and D3 requires the executing carrier's exact operation identity to be a member. The A/B fixture exercises both runtime isolation and the transition (`:158-179`, `:255-290`, `:612-620`). | **RESOLVED.** Approval for A cannot authorize B without a changed, widening transition identity and remotely prior authority. |
| GPT r2 3 — opaque-JavaScript representation and D3 fail-closed census | D9 now distinguishes exact/member site rows from one honest operation-level `opaque-module` entry with null `siteId`, `writeForm: opaque`, the closed JavaScript form ceiling, a closed table ceiling, runtime-resolved policy facts, and source/posture evidence. D3 permits that entry in Phase 1 only under `conservative-v1`, treating every ceiling table as reachable by all JavaScript forms and every field/constraint as patch-reachable; a missing/opaque table ceiling or uncovered insert/patch conflict refuses. Phase 2 refuses the remaining opaque entry (`:272-290`, `:470-494`, `:647-653`). | **RESOLVED.** The projection no longer fabricates a site/form census, and the admission gate conservatively covers precisely the information opacity hides. |
| Claude r2 1 — opaque-refusal phase ambiguity | D9 pins the boundary directly: Phase 1 admits only declared conservative opacity with a closed table ceiling, while Phase 2 refuses every remaining opaque entry even if it passed Phase 1. The rollout repeats the same rule and supplies diagnostic goldens for both refusal phases (`:485-494`, `:593-595`, `:647-652`). | **RESOLVED.** There is one executable phase interpretation. |
| Claude r2 2 — identical-absent proof did not cover intermediate alias observers | D4 quantifies the proof over every intermediate observer and the complete public outcome, expressly rejects the identical-byte `Get` followed by divergent `Guard` shape, and extends the marker through all later observations and effects. Acceptance item 3 contains that exact negative plus the full post-check chain (`:311-330`, `:621-632`). | **RESOLVED.** Matching the adjacent read's direct error is no longer sufficient to establish composition. |
| Claude r2 3 — reciprocal LLP 0234 amendment remained implicit | Migration now records a pending, pre-activation Phase-1 obligation to amend LLP 0234 D5/D6 with the shared `writePosture`, digest/ledger/approval/comparator extension, operation-set growth rule, and D9 projection pointer; it also says this Spec neither performs nor claims that amendment (`:566-577`). | **RESOLVED.** The dependency has a concrete completion boundary and enumerated amendment contents without misrepresenting LLP 0234's current state. |

## NEW findings

None.

VERDICT: READY
