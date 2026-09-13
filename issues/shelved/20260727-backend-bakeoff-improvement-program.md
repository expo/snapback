# Backend bakeoff improvement program

**Status:** Open — local program complete; hosted residuals
**Impact:** 5  
**Urgency:** 4  
**Ease:** 1  
**Confidence:** 5  
**Severity:** P1  
**Systems:** Developer experience, Authoring, React, Code generation, Search, Storage, Testing, Deployment, Ephemeral state  
**Author:** Codex, directed by Charlie Cheever  
**Date:** 2026-07-27  
**Related:** working-copy `demos/signal-desk/COMPARISON.md`, Diary 0022, LLP 0010, LLP 0016, LLP 0041, LLP 0064, LLP 0065, LLP 0072, LLP 0073, LLP 0074, LLP 0080, LLP 0081, LLP 0090  
**Marker:** program-index, backend-bakeoff

The Signal Desk comparison found sixteen ways Snapback could offer a more
competitive product loop. A repository audit shows that several findings
describe already-shipped primitives that the demo did not use, while the
remaining gaps range from documentation-sized fixes to new storage and hosted
runtime capabilities. This program closes the real gaps without duplicating
existing programs or weakening Snapback's capability honesty.


## Triage (2026-08-26 leftover sweep)

Still open as the hosted-residual index. Relation/activity closed 2026-08-03 (`issues/closed/20260727-relation-and-activity-patterns.md`; LLP 0110 Accepted). Live residuals are `issues/shelved/20260726-0072-fly-adapter-remaining-surface.md`, `issues/shelved/20260727-hosted-ephemeral-parity.md`, and `issues/shelved/20260728-hosted-lifecycle-carrier-and-custody-gap.md`. Newest published closure at sweep time is **0.1.27**, not 0.1.1/0.1.24.

## Classification

| Comparison item | Current classification | Owning ticket or disposition |
| --- | --- | --- |
| 1. installable React starter | Implemented and publicly qualified | `closed/20260727-installable-react-starter.md` |
| 2. one `snapback dev` supervisor | Implemented | LLP 0041 and package suite |
| 3. exact runtime/link doctor | Implemented | closed `20260727-guide-gap-runtime-link-smoke.md` |
| 4. binary identity mismatch message | Implemented | closed `20260727-guide-gap-runtime-link-smoke.md` |
| 5. provider/query/mutation/presence hooks | Implemented | closed `20260727-first-class-react-surface.md` |
| 6. precise handler result types | Implemented | closed `20260727-sound-handler-result-contracts.md` |
| 7. colocated declaration/handler | Implemented | closed `20260727-colocated-function-authoring.md` |
| 8. typed aggregate subscriptions | Implemented | closed `20260727-typed-live-query-groups.md` |
| 9. indexed text search | Implemented for local SQLite | closed `20260727-portable-indexed-text-search.md` |
| 10. parent/child and write/activity helpers | Contributor-source complete; publication residual | `20260727-relation-and-activity-patterns.md` |
| 11. explicit seed evolution | Implemented | closed `20260727-versioned-seed-identity.md` |
| 12–13. reviewable artifacts and summary | Implemented | closed `20260727-codegen-review-surface.md` |
| 14. comparator-grade acceptance helper | Implemented and publicly revalidated | `closed/20260727-comparator-acceptance-kit.md` |
| 15. supported hosted loop | Fail-closed prerequisite implementation; carrier/custody GAP | `20260726-0072-fly-adapter-remaining-surface.md`, `20260728-hosted-lifecycle-carrier-and-custody-gap.md` |
| 16. hosted ephemeral parity | Gap; capability remains false | `20260727-hosted-ephemeral-parity.md` |

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
   product imports, the LLP corpus audit is clean, and the most recent
   eligible complete battery is green on the program's claim-relevant gates
   (LLP 0189 D-6; unrelated reds ticketed and named, not blocking).

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

## Local-program checkpoint — 2026-07-28

The final local Signal Desk receipt is
`demos/signal-desk/acceptance/results/backend-bakeoff-run.43d6c570f7f3f752f61ca545a1d81ef1a1a6b3b4d34fbe0066a6becc95d3d989.v2.json`.
It binds clean runtime revision `f789a143`, passes all eight required lanes,
and has a final independent `READY` review at retention commit `7f92156b`.
The comparison now ranks Convex first, Snapback second, and Supabase third for
the scoped application-authoring exercise.

The public starter and comparator revalidation completed on 2026-07-30 against
the immutable public `0.1.1` closure on clean Darwin/arm64 and Linux/x64 hosts;
their tickets are closed. The program remains open only for the deliberately
honest hosted/publication residuals: positive public-package or cross-target
relation/activity authority, the hosted lifecycle carrier and custody design,
its remote Fly/Tigris corpus, and hosted ephemeral parity. No local capability
is held back by the bakeoff rerun.

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
  suites, and an independent final review pass are green, with the most
  recent eligible complete battery green on the claim-relevant gates
  (LLP 0189 D-6) in place of a full local proof at one commit.

## Triage freshness note (2026-08-01 sweep)

Still valid as the index of exactly four hosted/publication
residual rows (20260726-0072-fly-adapter, 20260727-relation-and-
activity, 20260727-hosted-ephemeral-parity, 20260728-hosted-lifecycle-
carrier) — all four still open. The '0.1.1 closure' revalidation note is
two releases stale (0.1.7 then 0.1.8 published, 253cb838, ledger
fastpath-ledger-0.1.8-5d5c6b7183af). The newer program index is
demos/improvement-sweep/reports/sweep-report.md §4 +
gap-ledger.v1.json; that ledger deliberately indexes only the 54 LLP
0137 findings, so this ticket remains the owner of these four rows.

## Expired bounded-children GAP review disposition — 2026-08-20

The `backend.bounded-children-v1` Guide review gate fired on 2026-08-20. A
fresh source and publication audit confirms that the GAP is still real:

- the exact `local-dev-sqlite-ibex` contributor-source carrier still publishes
  `bounded_children_v1`, and the codegen declaration remains authorable;
- `crates/snapback-engine/src/manifest/capabilities.rs` still refuses the
  relation/activity carrier when `buildDistribution` is not
  `contributor-source`, so public-package source presence is not a positive
  runtime capability fact;
- the recorded newest public closure is 0.1.24, but no
  `PackageCapabilityAttestationV1` has shipped to authorize this capability in
  that closure; and
- `schemas/capability.manifest.remote-service-sqlite-ibex.json` still lists
  `bounded_children_v1` in `capabilityGaps`, with no hosted target corpus or
  target-scoped publication authority establishing a contrary claim.

The Guide row therefore remains a GAP. Its authorities are corrected to the
actual governing publication documents (LLP 0110, LLP 0113, and LLP 0108), and
its next review is **2026-09-30**. That date is not a schedule-only rollover:
it aligns this row with LLP 0110's existing Charlie-owned review milestone for
the shared release-key-signed packaged-capability attestation rather than
inventing a separate date for the same prerequisite.

Before that review, the disposition must cover both residuals:

1. **Public package:** either ship and verify the LLP 0110
   `PackageCapabilityAttestationV1` chain (release key, binary and target
   identity, tarball/post-promotion lineage, source revision, and embedded
   local-carrier binding) with positive packaged-closure acceptance, or record
   an explicit author decision that keeps public packages unsupported.
2. **Hosted:** either land the relation/activity claim family's target-scoped
   hosted publication carrier and executable hosted corpus, with
   `bounded_children_v1` removed from the hosted capability gaps, or record an
   explicit product decision that hosted bounded children remain a nonclaim.
3. Update the carrier/receipt evidence, Guide wording, and capability row from
   those outcomes. The date must not move again without another evidence-based
   disposition.

## Expired write-activity GAP review disposition — 2026-08-22

The `backend.write-activity-v1` Guide review gate fired on 2026-08-22. A fresh
review against `main` at `9bd79dc4d` confirms that the GAP is still real:

- the source-owned relation/activity carrier still publishes
  `write_activity_v1` only for the exact `local-dev-sqlite-ibex`
  contributor-source profile, and the retained conformance receipt still
  records public-package status as `withheld-structured-gaps`;
- `crates/snapback-engine/src/manifest/capabilities.rs` still rejects that
  carrier when `buildDistribution` is not `contributor-source`, because no
  release-key-verified `PackageCapabilityAttestationV1` loader has landed;
- `schemas/capability.manifest.remote-service-sqlite-ibex.json` still lists
  `write_activity_v1` in `capabilityGaps`, and no hosted relation/activity
  corpus or target-scoped publication carrier establishes a contrary claim;
  and
- LLP 0295 W4's landed writer-seam product projection and bounded composition
  helpers do not alter the older relation/activity publication authority,
  while W5's accepted packet is explicitly local diagnostics with hosted
  telemetry deferred. Neither landing closes either residual above.

The Guide row therefore remains a local, partial GAP. Its wording now names
the contributor-source boundary and both withheld target classes, and its
authorities point to LLP 0110/0113's actual publication contract. Its next
review is **2026-09-30**, aligned with the same Charlie-owned, release-key-
signed packaged-capability attestation milestone already governing the atomic
relation/activity pair. That date must not move again without another source,
package, and hosted-publication review.
