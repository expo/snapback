# LLP 0134: Capability maturity promotion to stable

**Type:** Spec
**Status:** Draft
**Systems:** Capability publication, Application data API, Relational queries, Code generation, Packaging, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:**
**Related:** LLP 0005, LLP 0058, LLP 0061, LLP 0076, LLP 0080, LLP 0081, LLP 0108, LLP 0109, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0115, LLP 0120, LLP 0127, LLP 0130, issue `20260731-cv8-piece2-stable-promotion-design`

## Summary

LLP 0113 §1 fixes the maturity model this Spec completes: capability maturity
is a static code-owned constant on the closed `TargetCapabilityId` registry,
publication CAS changes only the verified runtime-support fact and never the
maturity constant, and "promotion to stable requires a later ratified design
and evidence; elapsed time or successful demos are insufficient." This Spec is
that later ratified design. It specifies the code-and-document path by which a
qualified experimental capability id becomes stable: the evidence bar a
promotion requires, who ratifies it, the mechanics of the promotion commit,
the acknowledgment-gate consequences, demotion when a stable claim regresses,
and the closed grandfather set for which LLP 0080-style direct-to-stable
remains reserved (LLP 0127 decision 3, recorded in LLP 0115 open question 8).

It extends LLP 0113 without reopening it: no runtime carrier, CAS, or
supervisor object defined there gains authority over maturity, and nothing
here makes any support fact true. It is CV-8 piece 2 of LLP 0115, authored as
a small owned design beside LLP 0113 per its execution ticket; the landing
shape remains an author call at review time. Throughout, "LLP 0005" means the
review-process guide (`vendor/llp/llp/0005-rfc-process.guide.md`): reviews
are inputs, never approvals, and the author decides.

## 1. Maturity semantics and the two routes

The registries of record are:

- the Rust registry, `TargetCapabilityId::maturity` in `src/manifest.rs`,
  the sole runtime authority, guarded by the exhaustive registry test
  `capability_maturity_promotions_hold_and_admission_stays_fail_closed`; and
- the codegen mirror, `EXPERIMENTAL_TARGET_CAPABILITY_IDS` in
  `packages/snapback-codegen/index.mjs`, from which generated artifacts
  derive their experimental acknowledgments (LLP 0058 §Capability maturity,
  amendment 2026-07-24).

At this writing both registries agree on seven experimental ids:
`bounded_children_v1`, `write_activity_v1` (LLP 0110), `inline_handler_v1`,
`result_contract_v1` (LLP 0108), `registered_bundle_boot_v1` (LLP 0112), and
`versioned_seed_install_v1`, `versioned_seed_reset_v1` (LLP 0109). Every
other registered id is stable.

Maturity is registry-global and orthogonal to support. Promotion never makes
a support predicate true anywhere: a target without the id's positive
predicate reports the same honest GAP before and after (LLP 0058's posture;
LLP 0074's no-overclaim rule). Conversely, verified runtime support on every
target in the world does not move the constant. The two facts change through
disjoint machinery, and this Spec governs only the constant.

Two promotion routes exist, and only two:

1. **The default route.** The id enters the registry at `experimental`,
   earns verified runtime support through its publication authority —
   LLP 0113's qualification and claim-family machinery for hosted targets;
   the source-owned `LocalCapabilityPublicationV1` /
   `PackageCapabilityAttestationV1` carriers (LLP 0110 §Local and packaged
   publication authority) for local and packaged targets — and then promotes
   under §2–§4. Mandatory for every id minted after 2026-07-30. Where an
   id's family kind is not yet in LLP 0113 §4's closed union, adding it is a
   dated LLP 0113 amendment; this Spec widens nothing by inference.
2. **The grandfathered direct act,** reserved by LLP 0127 decision 3 for the
   closed set in §7 and available to no other surface.

Ids that publish as one atomic claim family (the relation/activity pair
`bounded_children_v1` + `write_activity_v1`, LLP 0110 §Hosted union carrier)
promote, and demote, together: one receipt, one commit. Their evidence is
shared; a split promotion would claim what was never separately witnessed.

## 2. The promotion evidence bar

A promotion proposal binds all eight items below, each witnessed at the exact
promotion-candidate source revision and retained in-tree by digest. A missing
or vacuous item refuses the promotion; there is no partial credit.

- **E1 — Governing-contract standing.** The id's governing LLP is Accepted
  after a dual-family LLP 0005 loop and has reached Implemented with every
  §Acceptance item witnessed, receipts retained. A Draft or Review contract
  cannot promote: `experimental` exists precisely because the governing
  contract is not Accepted (the `CapabilityMaturity` vocabulary in
  `src/manifest.rs`).
- **E2 — Acceptance-corpus breadth.** The complete target-applicable
  acceptance corpus reruns green at the candidate revision on every target
  profile whose support predicate is true. GAP rows on non-supporting
  targets are honest GAPs, not breadth; a run inherited from an older
  revision is not evidence.
- **E3 — Adversarial fixtures.** The corpus's negative rows rerun green in
  the same run: refusal properties, fail-closed diagnostics, isolation and
  existence-secrecy negatives, and — mandatory — the id's
  acknowledgment-gate refusal (an artifact requiring the id without
  acknowledgment is refused at admission), witnessed at the candidate
  revision as the final record of the gate this promotion removes. For ids
  whose support rode the LLP 0113 route, the applicable §6 negatives are
  included.
- **E4 — Capability-claim audit.** An `llp-maintain`-style audit receipt at
  the candidate revision: both registries agree; generated artifacts, the
  guide capability index and its GAP rows (LLP 0061), diagnostics, and the
  governing document's claims are mutually consistent; no overclaim and no
  stale experimental reference survives; `./ref-check --verbose` is green.
- **E5 — At least one real consumer arm.** An application consumer outside
  the acceptance corpus and comparator fixtures consumes the capability
  through the ordinary generated surface, under an ordinary principal (never
  the acceptance or observation principal), exercising the profile's primary
  declared shape, with a retained diary entry or equivalent receipt. For
  `write_activity_v1` this means an arm with real `existing-owner.v1`
  provenance; the anonymous-arm gap (LLP 0120 open question 5) narrows the
  candidate pool and does not waive the item.
- **E6 — Soak / no-regression window.** At least 14 consecutive days of
  verified runtime support on at least one ordinary target profile,
  immediately preceding the promotion commit, during which there were zero
  support-fact regressions on any supporting target, zero claim-family
  withdrawals, zero maturity demotions of the id, and zero open MATERIAL
  defects against the id's contract — plus at least one full E2+E3 rerun
  inside the window. Any disqualifying event resets the window start. The
  14-day figure matches LLP 0113's retention scale; amending it is a dated
  revision here and never applies mid-window.
- **E7 — Support-evidence lineage.** The receipts that made runtime support
  true, bound by digest: for the LLP 0113 route, the qualification receipt
  and final claim-family lineage (LLP 0113 §5); for local targets, the
  embedded `LocalCapabilityPublicationV1` carrier digest; for packaged
  runtimes, the `PackageCapabilityAttestationV1`.
- **E8 — Author adjudication.** The author's own dated ratification (§3),
  recorded in the receipt.

## 3. Who ratifies

Promotion is ratified by the author, per LLP 0005: the evidence receipts and
any review artifacts are inputs; nobody — human, model, or standing rule —
accepts on the author's behalf.

**The SD-4 boundary, stated explicitly.** LLP 0130 SD-4 is a standing
*document-acceptance* rule: it authorizes Review → Accepted for documents the
accepted programs commissioned — including this Spec itself — and nothing
else. A maturity promotion is a claim-increasing code-and-document change,
not a document status transition, so SD-4 does not and cannot cover it. No
standing decision covers maturity promotion today; delegating routine
promotions would be an explicit dated LLP 0130 amendment. Absent one, every
promotion — default or grandfathered — is the author's own dated
adjudication, recorded as such (LLP 0130's honesty framing: a standing
acceptance is never presented as a fresh manual one, and vice versa).

LLP 0130 ER-2 binds this Spec: no promotion, and no future amendment here,
may weaken an evidence boundary; a proposal that would do so escalates to the
author regardless of how many receipts it carries. Demotion (§6) is the
asymmetric case: it reduces a claim, so it is a duty on discovery, not an
adjudication gate.

## 4. The promotion act

A promotion is one dated commit that carries the promotion and nothing else
(the LLP 0130 SD-6 serialization principle). The commit:

1. moves the id from the `Experimental` arm of `TargetCapabilityId::maturity`
   to the stable default in `src/manifest.rs`, with a dated comment citing
   this Spec and the receipt digest, and carrying an `@ref LLP 0134`
   annotation;
2. removes the id from `EXPERIMENTAL_TARGET_CAPABILITY_IDS` in
   `packages/snapback-codegen/index.mjs` — both registries change as the
   same act, the mechanical shape the LLP 0080 precedent set;
3. updates the exhaustive registry test and the codegen acknowledgment
   tests so the new assignment is pinned;
4. commits the promotion receipt (below) under
   `acceptance/results/maturity/`, content-addressed, its digest cited by
   the commit message and the registry comment;
5. adds a dated promotion addendum to the id's governing LLP recording the
   act, the receipt digest, and the adjudication; and
6. updates the guide capability index row and any program board row in the
   same commit (LLP 0130's board-lockstep lesson).

`MaturityPromotionReceiptV1` is a closed canonical-JSON document:

```text
{
  schemaVersion: 1,
  route: "default.v1" | "grandfathered-direct.v1",
  capabilityIds,            // the atomic set, sorted; usually one id
  fromMaturity: "experimental",
  toMaturity: "stable",
  governingLlp,
  governingStatusAtPromotion,
  candidateSourceSha,
  corpusRunDigests,         // E2 + E3, per target profile
  claimAuditDigest,         // E4
  consumerArmRefs,          // E5: diary/receipt paths + digests
  soakWindow?,              // E6: { start, end, targetProfileId };
                            // absent only on the grandfathered route
  supportEvidenceDigests,   // E7, or shipped-history refs when
                            // route = "grandfathered-direct.v1"
  authorAdjudication,       // E8: { date, record }
  promotionDate
}
```

The receipt is document evidence, not a runtime object. No target parses it,
no supervisor signs it, and no wire carrier transports it; the registry
constants remain the sole runtime authority. LLP 0113 §1's sentence
"publication CAS changes only the verified runtime-support fact, never the
maturity constant" is unchanged and load-bearing: this Spec adds the missing
half — what the code-and-document change requires — and contradicts nothing.

## 5. Acknowledgment-gate consequences

On promotion, the id leaves the codegen experimental set, so newly generated
artifacts stop emitting its acknowledgment and admission stops requiring one.
Existing artifacts that still acknowledge the promoted id are unaffected —
stable acknowledgment is a no-op (the existing registry rule) — so promotion
forces no regeneration. Function-level capability requirements, support
predicates, and GAP reporting are untouched: the gate that disappears is
exactly the experimental-acknowledgment refusal, nothing else.

## 6. Demotion and rollback

Support withdrawal and maturity demotion are different tools. The immediate
cut for a live incident is support withdrawal — claim-family withdrawal or
expiry (LLP 0113 §4), local carrier removal plus restart (LLP 0110) — which
this Spec leaves untouched. Demotion corrects the maturity claim itself.

Demotion triggers: a witnessed MATERIAL regression of the stable contract; a
promotion receipt's evidence discovered wrong or unreproducible; or shipped
behavior materially diverging from the governing contract. Because demotion
reduces a claim, any maintainer or agent lands it on discovery — holding a
known-false stable claim open pending adjudication would itself violate the
honesty rules — and notifies the author the same day.

The demotion commit mirrors §4: both registries and their tests change in one
dated commit that carries a `MaturityDemotionRecordV1` (the id set, trigger
evidence digests, the voided promotion receipt's digest, date) and a dated
addendum in the governing LLP. Consequences are fail-closed:

- the acknowledgment gate returns for new admissions;
- artifacts generated during the stable window carry no acknowledgment, so
  at their next admission they refuse under the ordinary experimental rule
  until regenerated — no artifact is silently grandfathered;
- running processes are never cut by the constant (it is static per binary);
  the operational cut, if one is needed, is support withdrawal; and
- demotion never rolls back the active graph, production data, or unrelated
  capabilities (LLP 0113's rule, inherited).

Re-promotion runs the full §2 bar afresh — new soak, new corpus runs, new
receipt. A voided receipt is never reused.

## 7. The grandfather set

LLP 0127 decision 3 (2026-07-30, registry LLP 0115 open question 8) reserves
the LLP 0080-style direct-to-stable act for "surfaces with witnessed shipped
implementations predating the rule." The precedent acts are already complete
and are cited as shape, not as members: `bounded_response_stream_v1` left the
experimental set as LLP 0076's acceptance (2026-07-25), and
`relational_query_v1` plus `migration_keyset_scan_v1` were promoted to stable
in both registries as the same act as LLP 0080/0081's witnessed Implemented
transition (2026-07-26) — before LLP 0113 existed.

The closed set — the only surfaces that may still use the direct act:

| Id | Governing LLP |
| --- | --- |
| `inline_handler_v1` | LLP 0108 |
| `result_contract_v1` | LLP 0108 |
| `registered_bundle_boot_v1` | LLP 0112 |
| `versioned_seed_install_v1` | LLP 0109 |
| `versioned_seed_reset_v1` | LLP 0109 |

Each has a registered implementation whose positive predicate held in shipped
acceptance and demo use before 2026-07-30, and each is experimental today
solely because its governing contract is not yet Accepted. Excluded, by name:
`bounded_children_v1` and `write_activity_v1` — their complete publication
receipt has not passed and they are the default route's first consumers (§8)
— and every id minted after 2026-07-30, so the set is closed by construction
and can only shrink.

The reserved act is the 0080 shape, not a waiver of honesty: it requires E1
(Accepted after the dual-family loop, then witnessed Implemented), E2–E5, E8,
and the §4 one-commit mechanics with `route: "grandfathered-direct.v1"` in
the receipt. Waived are E6 and E7's qualification lineage only — the
pre-rule shipped history substitutes and must be cited in the receipt. A
material normative revision to a member's contract after 2026-07-30 voids its
reservation; the surface then has no promotion route until a dated amendment
gives its support authority a qualification path. That outcome is fail-closed
on purpose.

## 8. First consumers and sequencing

The first consumer of the default route is LLP 0110's atomic pair,
`bounded_children_v1` + `write_activity_v1`, when E1–E8 are met — E5 will
require a real provenanced consumer arm and E6 the 14-day soak over verified
support. Until then both ids remain statically experimental with
acknowledgment-gated support — exactly LLP 0120 finding 9's terminus, now
with a specified exit.

The sequence-allocation primitive and the 3a snapshot-batch composite
(LLP 0127 decision 3's shipping order) enter the registry at experimental on
the default route when their designs land, and reach stable only through this
Spec. Per the executing ticket, this document promotes nothing itself.

## 9. Acceptance

- **A1 — Cross-registry parity gate.** A committed check asserts the codegen
  experimental set equals the Rust registry's non-stable table, so a
  one-sided maturity flip fails CI. This gate lands with this Spec's first
  implementation commit, before any promotion executes.
- **A2 — Receipt validation.** A committed validator parses every
  `acceptance/results/maturity/*.json` receipt against the closed §4 schema
  and refuses unknown members, missing bar items for the declared route, or
  a digest mismatch with the registry comments.
- **A3 — First-promotion shape.** The first executed promotion lands as one
  commit containing both registry changes, the updated tests, the conforming
  receipt, the governing-LLP addendum, and the guide/board rows — verified
  against the commit itself.
- **A4 — The gate's last witness.** The E3 acknowledgment-gate negative at
  the candidate revision is retained with the receipt.
- **A5 — No unreceipted flip.** Any maturity change in either registry
  without a same-commit conforming receipt is a violation of this Spec, in
  either direction; A1 plus A2 make the one-sided and malformed cases
  mechanically detectable.

This Spec's own Review → Accepted transition may ride LLP 0130 SD-4 if it
converges dual-family READY with zero unresolved MATERIAL concerns, within
its decided scope, weakening no evidence boundary — recorded per SD-4. Its
§Acceptance items gate Implemented as usual.

## Non-goals

- No runtime carrier, CAS, claim family, or supervisor object for maturity.
- No support widening: promotion never touches a support predicate, target
  fact, or GAP row.
- No reopening of LLP 0113's qualification protocol, LLP 0110's profiles, or
  LLP 0080's relational semantics.
- No packaging or channel policy: npm dist-tags and release ledgers stay
  with LLP 0041/0111; hosted capability claims stay nonclaims until their
  own evidence (LLP 0115 governing constraint 2).
- No general capability-id versioning or deprecation policy; retiring a
  stable id is future work with its own design.

## Open questions

1. Is 14 days the right soak scale once promotions become routine, and
   should the window ever require both hosted and local profiles rather
   than "at least one ordinary profile"?
2. Should routine promotions ever gain a standing LLP 0130 rule? This Spec
   deliberately grants none.
3. Should grandfather members waive their reservation and take the default
   route once qualification families exist for them, shrinking §7's set by
   choice?
4. Do the sequence primitive and 3a composite ride dated LLP 0113 family
   additions, or does a successor generalize the family union? Assumed the
   former; owned by LLP 0113 either way.

## Status

**Draft.** Authored 2026-07-31 as LLP 0115 CV-8 piece 2 under its execution
ticket (`issues/20260731-cv8-piece2-stable-promotion-design.md`), within the
program LLP 0130 governs. This document specifies the promotion path; it
claims and promotes no maturity itself.
