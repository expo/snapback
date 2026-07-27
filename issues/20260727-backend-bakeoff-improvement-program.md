# Backend bakeoff improvement program

**Status:** Open  
**Impact:** 5  
**Urgency:** 4  
**Ease:** 1  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Developer experience, Authoring, React, Code generation, Search, Storage, Testing, Deployment, Ephemeral state  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** working-copy `demos/backend-bakeoff/COMPARISON.md`, Diary 0022, LLP 0010, LLP 0016, LLP 0041, LLP 0064, LLP 0065, LLP 0072, LLP 0073, LLP 0074, LLP 0080, LLP 0081, LLP 0090  
**Marker:** program-index, backend-bakeoff

The Signal Desk comparison found sixteen ways Snapback could offer a more
competitive product loop. A repository audit shows that several findings
describe already-shipped primitives that the demo did not use, while the
remaining gaps range from documentation-sized fixes to new storage and hosted
runtime capabilities. This program closes the real gaps without duplicating
existing programs or weakening Snapback's capability honesty.

## Classification

| Comparison item | Current classification | Owning ticket or disposition |
| --- | --- | --- |
| 1. installable React starter | Partial | `20260727-installable-react-starter.md` |
| 2. one `snapback dev` supervisor | Shipped | LLP 0041/package suite; prove it through the new starter |
| 3. exact runtime/link doctor | Gap | `20260727-guide-gap-runtime-link-smoke.md` |
| 4. binary identity mismatch message | Partial | `20260727-guide-gap-runtime-link-smoke.md` |
| 5. provider/query/mutation/presence hooks | Partial | `20260727-first-class-react-surface.md` |
| 6. precise handler result types | Partial, unsound edge | `20260727-sound-handler-result-contracts.md` |
| 7. colocated declaration/handler | Gap | `20260727-colocated-function-authoring.md` |
| 8. typed aggregate subscriptions | Gap over partial bundle/store primitives | `20260727-typed-live-query-groups.md` |
| 9. indexed text search | Gap | `20260727-portable-indexed-text-search.md` |
| 10. parent/child and write/activity helpers | Partial | `20260727-relation-and-activity-patterns.md` |
| 11. explicit seed evolution | Partial | `20260727-versioned-seed-identity.md` |
| 12–13. reviewable artifacts and summary | Partial | `20260727-codegen-review-surface.md` |
| 14. comparator-grade acceptance helper | Partial | `20260727-comparator-acceptance-kit.md` |
| 15. supported hosted loop | Partial, existing program | updated `20260726-0072-fly-adapter-remaining-surface.md` |
| 16. hosted ephemeral parity | Gap | `20260727-hosted-ephemeral-parity.md` |

## Program rules

1. Substantive semantic work does not start from a ticket alone. Search,
   colocated authoring, one-to-many relations, seed evolution, and hosted
   ephemeral semantics must first be governed by a Draft/Review LLP and pass
   the author-invoked `llp-super-refine` loop with real Fable 5 and Codex
   gpt-5.6-sol reviews recorded under `llp/reviews/`.
2. Existing authorities are amended instead of creating competing designs
   where they already cover the topic. A new LLP is used only for an uncovered
   contract.
3. Each ticket lands its code, generated schemas/artifacts, guide coverage,
   executable acceptance, and ticket resolution together. Partial capability
   work remains a machine-readable GAP.
4. The program is complete only when every ticket below is closed, the bakeoff
   Snapback arm uses the paved surfaces without casts or repository-relative
   product imports, the LLP corpus audit is clean, and the complete local proof
   passes.

## Sequencing

- **Foundation:** diagnostics, result contracts, codegen custody/summary.
- **Authoring/client:** React starter and surface, colocated functions, typed
  query groups, relation/activity patterns, seed identity.
- **Data capability:** portable indexed text search.
- **Evidence:** comparator acceptance kit and rerun of Signal Desk.
- **Hosted:** finish the existing Fly lifecycle profile, then qualify hosted
  ephemeral semantics without inheriting claims across targets.

Independent tickets may run in parallel after their governing LLP revision
hashes are fixed. Integration must preserve one generated identity and one
client external-store seam rather than introducing compatibility layers that
silently fork semantics.

## Program acceptance

- Every row above has a closed ticket or an explicit shipped disposition with
  current executable evidence.
- `snapback new` can create a React app that runs through `snapback dev` from
  package dependencies and renders a typed generated live query.
- Ordinary React code uses generated refs, inferred args/results, grouped live
  state, mutation settlement, and presence without custom subscription cleanup.
- Search is indexed, portable at the declared profile, paginated, capability
  reported, and authorization safe.
- Codegen review shows one compact committed manifest plus policy-required
  projections, an ignored reproducible cache, and an actionable summary.
- One package-owned command proves the comparator properties without a
  repository-private harness.
- The supported hosted receipt covers stable URL/identity, logs, inspection,
  migration, backup/restore, rollback, cost visibility, and explicitly scoped
  ephemeral semantics.
- `./ref-check --verbose`, `node scripts/check-guide.mjs`, the relevant package
  suites, the full local proof, and an independent final review pass are green.
