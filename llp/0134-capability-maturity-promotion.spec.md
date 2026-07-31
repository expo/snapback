# LLP 0134: Capability maturity promotion to stable

**Type:** Spec
**Status:** Draft
**Systems:** Capability publication, Application data API, Relational queries, Code generation, Packaging, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-07-31 (v0.2, round-1 dual-family review fixes — both
round-1 reviews NOT READY
(`reviews/0134-capability-maturity-promotion.fable.md`: 3 MATERIAL C1–C3,
3 should-fix C4–C6, 4 details C7–C10;
`reviews/0134-capability-maturity-promotion.codex.md`: 8 MATERIAL,
1 MINOR). Merged and applied once per item: E6's soak witness defined per
route with digest-bound `soakEvidence`, a closed defect corpus, a finite
population, and a gap/reset rule; §2's anchoring preamble corrected; §7's
0110-pair exclusion restated on tree-true grounds, with per-member
grandfather evidence manifests, a decidable baseline-digest void rule,
dated tombstones, and the SD-1 interplay note; closed evidence locators
throughout the receipt plus `MaturityDemotionRecordV1` as a closed
schema; the promotion commit's sole parent pinned to `candidateSourceSha`
with a history-aware A5; E5 lanes scoped per capability class; the
demotion act grounded in LLP 0005 — author-adjudicated with an
objective-trigger fast path proposed as this Spec's own standing
delegation; A1 specified as canonical-JSON emission compared in CI; E4
split into candidate and promotion-tree audits; E1's history corrected on
the 0080 precedent; records rooted at `tests/acceptance/maturity/`; the
seed pair joined to the promote-together rule; the local-carrier escape
hatch added; SD-6 cited as instantiation.)
2026-07-31 (v0.3, round-2 dual-family review fixes — both round-2
reviews NOT READY
(`reviews/0134-capability-maturity-promotion.fable.md` round 2: C1–C4
and C6–C10 resolved, the C5 refutation re-verified in-tree and
withdrawn by the reviewer, new MATERIAL C11, should-fix C12, details
C13–C17; `reviews/0134-capability-maturity-promotion.codex.md`
round 2: items 3–5, 7, 9 resolved, residues on items 1, 2, and 6, new
MATERIAL N1/N2, MINOR N3). Merged and applied once per item: E6's
three evidence classes given closed canonical-JSON schemas and A2
suffix lanes (`*.soak-observation.json`, `*.soak-extract.json`,
`*.defect-search.json`) plus the same-UTC-day commit rule for
observation receipts; `MaturityDemotionRecordV1` gains
`candidateSourceSha`/`candidateParentSha`, making A5's parent
comparison provable for demotions; the promotion-tree audit anchored
on `candidateParentSha` plus its own content digest, the commit SHA
derivable post hoc and recorded as a dated follow-up addendum line,
never inside the receipt; the grandfather baseline bound as a
whole-file-bytes locator at a named baseline commit; §7's 0110
demo-use ground restated tree-true — Signal Desk's real
bounded-children declarations conceded, the honest ground being no
joint real production consumer outside the acceptance corpus and
comparator fixtures; `voidedReceiptRef` as a closed locator; fast-path
registry visibility, revocation, and lapse semantics; the
`result_contract_v1` manifest count corrected to five.)
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
   dated LLP 0113 amendment; this Spec widens nothing by inference. The
   local leg is symmetric: LLP 0110's carrier binds the two atomic
   relation/activity ids exactly and generalizes to nothing else, and the
   other experimental ids' local facts are plain registered booleans gated
   by their conformance suites — where a local or packaged id has no
   source-owned carrier definition, adding one is a dated amendment to
   LLP 0110 or to the id's governing LLP (or a small owned carrier design
   of its own), never an inference from this Spec.
2. **The grandfathered direct act,** reserved by LLP 0127 decision 3 for the
   closed set in §7 and available to no other surface.

Ids that publish as one atomic claim family (the relation/activity pair
`bounded_children_v1` + `write_activity_v1`, LLP 0110 §Hosted union carrier)
promote, and demote, together: one receipt, one commit. Their evidence is
shared; a split promotion would claim what was never separately witnessed.
The rule follows the evidence, not only the wire carrier: the seed pair
`versioned_seed_install_v1` + `versioned_seed_reset_v1` is advertised only
after one closed mandatory suite passes every local row (the registry gate
in `src/manifest.rs` carrying `@ref LLP 0109`), so its evidence is
likewise shared and the pair promotes and demotes together. An id coupled
this way gains a solo route only when a dated revision here records every
§2 item witnessed for it severally.

## 2. The promotion evidence bar

A promotion proposal binds all eight items below, each retained in-tree as
digest-bound evidence in the receipt (§4). Their anchoring differs, and is
stated honestly: E2, E3 (including the last-gate negative), and E4's
candidate audit are witnessed at the exact promotion-candidate source
revision; E1, E5, E6, and E7 are historical or time-extended facts — a
review loop's history, a consumer arm, a window that spans revisions,
lineage that predates the candidate — bound by closed evidence locators
rather than re-witnessed at one SHA; E4's promotion-tree audit is
witnessed on the staged promotion tree and anchored by
`candidateParentSha` plus its own digest (§4's staged-tree rule); E8 is
the author's dated act. A
missing or vacuous item refuses the promotion; there is no partial credit.

- **E1 — Governing-contract standing.** The id's governing LLP is Accepted
  after a dual-family LLP 0005 loop and has reached Implemented with every
  §Acceptance item witnessed, receipts retained. A Draft or Review contract
  cannot promote, and acceptance alone is not the exit: `experimental`
  persists until the contract is Accepted, witnessed Implemented, and the
  id explicitly promoted under a route here (the `CapabilityMaturity`
  vocabulary in `src/manifest.rs`; LLP 0080's ids stayed experimental
  after its 2026-07-24 acceptance until the Implemented witnesses landed
  2026-07-26).
- **E2 — Acceptance-corpus breadth.** The complete target-applicable
  acceptance corpus reruns green at the candidate revision on every target
  profile — drawn from the closed profile list, codegen's
  `TARGET_PROFILES` — whose support predicate is true. GAP rows on
  non-supporting targets are honest GAPs, not breadth; a run inherited
  from an older revision is not evidence.
- **E3 — Adversarial fixtures.** The corpus's negative rows rerun green in
  the same run: refusal properties, fail-closed diagnostics, isolation and
  existence-secrecy negatives, and — mandatory — the id's
  acknowledgment-gate refusal (an artifact requiring the id without
  acknowledgment is refused at admission), witnessed at the candidate
  revision as the final record of the gate this promotion removes. For ids
  whose support rode the LLP 0113 route, the applicable §6 negatives are
  included.
- **E4 — Capability-claim audit, two trees.** Two `llp-maintain`-style
  audit receipts, resolving what "stale" means on each side of the flip.
  (a) The candidate audit, at the candidate revision: both registries
  agree; generated artifacts, the guide capability index and its GAP rows
  (LLP 0061), diagnostics, and the governing document's claims are
  mutually consistent; the id's experimental references are present and
  current — at this revision the id *is* experimental, so those
  references are required, not stale; no overclaim; `./ref-check
  --verbose` is green. (b) The promotion-tree audit, on the staged
  promotion tree — the exact tree the promotion commit will carry:
  every authoritative registry, guide, and document statement reflects
  stable and no stale authoritative experimental reference survives,
  while historical generated acknowledgments remain explicitly
  permitted (§5). Its receipt is itself carried by the promotion
  commit, so it anchors on `candidateParentSha` plus its own content
  digest, and its locator's `sourceSha` is `candidateSourceSha` (§4's
  staged-tree rule); A5's final-tree run on the transition commit is
  the post-hoc witness that the staged tree and the landed tree agree.
  Both receipts are E4 evidence.
- **E5 — At least one real consumer arm.** A real consumer outside the
  acceptance corpus and comparator fixtures consumes the capability
  through its governing production authority lane, exercising the
  profile's primary declared shape. "Ordinary surface" is scoped per
  capability class, because for some capabilities that surface *is* the
  operator lane: application-surface capabilities require the ordinary
  generated surface under an ordinary application principal;
  administrative/startup-lane capabilities whose ordinary surface is the
  operator lane — the seed pair's `AdminWrite` / pre-bind startup
  authority (LLP 0109) — require the exact ordinary operator or startup
  authority, in a real app. In every class the acceptance, qualification,
  and observation principals are excluded, and a retained diary entry or
  equivalent receipt is required. For `write_activity_v1` this means an
  arm with real `existing-owner.v1` provenance; the anonymous-arm gap
  (LLP 0120 open question 5) narrows the candidate pool and does not
  waive the item.
- **E6 — Soak / no-regression window.** At least 14 consecutive days of
  verified runtime support immediately preceding the promotion commit,
  witnessed rather than asserted. All timestamps are UTC RFC 3339; the
  window start is inclusive, the end exclusive, and the end is the
  promotion date.
  - *Population.* The receipt's `soakEvidence.window` fixes the finite
    target population at window start: at least one ordinary profile from
    the closed profile list (codegen's `TARGET_PROFILES`) plus, for
    hosted members, the enumerated deployment identities. "Any supporting
    target" below means exactly this recorded population. A member added
    mid-window accrues no credit; a member leaving the population is a
    disqualifying event.
  - *Witness, hosted.* The supervisor journal's canonical renewal record
    for the id's claim family across the window — final carriers are
    renewable leases and renewals are journaled as canonical bytes
    (LLP 0113 §4.2) — exported as a digest-bound
    `MaturitySoakJournalExtractV1` extract (*Evidence records* below)
    showing family-epoch continuity with zero withdrawals and zero
    expiries.
  - *Witness, local.* Local support lives in ephemeral processes that
    re-derive the fact at each start from the embedded carrier, so
    continuity is witnessed by dated support-verification runs: at least
    one green run per UTC calendar day executes the id's mandatory
    support suite — the same closed suite whose green rows gate the
    registered fact; for the 0110 pair, the embedded-carrier and
    qualification-receipt verification — at the then-current main HEAD
    and emits a conforming `MaturitySoakObservationV1` receipt
    (*Evidence records* below) binding date, HEAD SHA, carrier/receipt
    digests, and outcome, retained under §4's records root. A calendar
    day with no green run is a coverage gap.
  - *Disqualifiers and reset.* Any support-fact regression on a
    population member, claim-family withdrawal, maturity demotion of the
    id, coverage gap, or population loss resets the window start, as does
    a MATERIAL defect against the id's contract open at any point in the
    window (MATERIAL in the review-severity sense the LLP 0005 loop
    artifacts use). The defect corpus is closed: open filesystem tickets
    under `issues/` (not `issues/closed/`), Linear issues in the Exact
    project with the Snapback label naming the id or its governing LLP,
    and the governing LLP's defect ledger where the LLP 0076/0077
    convention applies. The dated search over exactly these scopes is
    retained as a `MaturityDefectSearchV1` record (*Evidence records*
    below) and bound as `soakEvidence.defectSearchRef`.
  - *Rerun.* At least one full E2+E3 rerun inside the window.
  - *Evidence records.* Each E6 evidence class is a closed
    canonical-JSON document with its own suffix under §4's records
    root, A2-validated like every other maturity record.
    `MaturitySoakObservationV1` (`*.soak-observation.json`):
    `{ schemaVersion: 1, capabilityIds, dateUtc, headSha,
    suiteProducer, carrierDigests, outcome }` — one per local
    observation day. An observation is credited only when the commit
    introducing it carries a committer UTC date equal to its `dateUtc`
    (A2 refuses the mismatch), so a window cannot be back-fabricated
    by rerunning the suite at historical HEADs after the fact.
    `MaturitySoakJournalExtractV1` (`*.soak-extract.json`):
    `{ schemaVersion: 1, capabilityIds, claimFamily,
    deploymentIdentity, window, familyEpochs, renewalRecordDigests,
    withdrawalCount, expiryCount }` — the hosted journal extract.
    `MaturityDefectSearchV1` (`*.defect-search.json`):
    `{ schemaVersion: 1, capabilityIds, governingLlp, searchDateUtc,
    scopes, findings }` — the defect search. `soakEvidence`'s
    `observationRefs`, `journalExtractRef`, and `defectSearchRef` are
    closed evidence locators (§4) whose `schemaVersion` values name
    exactly these schemas: `soak-observation.v1`, `soak-extract.v1`,
    `defect-search.v1`.
  - *Binding.* The window, population, and the observation,
    journal-extract, and defect-search locators are all bound in the
    receipt's `soakEvidence` member (§4). The 14-day figure matches LLP 0113's
    retention scale; amending it is a dated revision here and never
    applies mid-window.
- **E7 — Support-evidence lineage.** The receipts that made runtime support
  true, bound by closed evidence locators (§4): for the LLP 0113 route,
  the qualification receipt and final claim-family lineage (LLP 0113 §5);
  for local targets, the embedded `LocalCapabilityPublicationV1` carrier;
  for packaged runtimes, the `PackageCapabilityAttestationV1`.
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
asymmetric case: discovering a demotion trigger creates a duty to propose
the demotion the same day, but the act itself remains the author's except
on §6's objective-trigger fast path — a standing delegation this Spec
itself proposes, effective only with the author's acceptance of this
document (an in-scope commissioned design, so SD-4 can carry that
acceptance), and recorded as a standing-rule act whenever used.

## 4. The promotion act

A promotion is one dated commit that carries the promotion and nothing else
(the serialization principle LLP 0130 SD-6 instantiates for its own scope
migration). The commit:

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
   `tests/acceptance/maturity/` — inside the existing acceptance-receipts
   root (`tests/acceptance/`, the `auth-mode-predecessor-v1.receipt.json`
   convention; conformance receipts live in `tests/conformance/`),
   deliberately not a new top-level directory — with its SHA-256 cited by
   the commit message and the registry comment;
5. adds a dated promotion addendum to the id's governing LLP recording the
   act, the receipt digest, and the adjudication; and
6. updates the guide capability index row and any program board row in the
   same commit (LLP 0130's board-lockstep lesson).

The promotion commit's sole parent must equal `candidateSourceSha`: no
merge commit, no stacked promotions, exactly one maturity transition per
`parent..HEAD` range (A5). There is no tolerated drift — if main advances
past the candidate revision before the landing, the candidate is
re-declared at the new head and the revision-anchored items (E2, E3, and
E4's candidate audit) are re-witnessed there. The receipt records the
parent as `candidateParentSha`, constrained equal to `candidateSourceSha`;
A5's transition check compares it against the commit's actual parent, so
the receipt never needs to name its own commit.

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
  candidateParentSha,       // == candidateSourceSha == the promotion
                            //   commit's sole parent
  reviewJournalRefs,        // E1: review artifacts, acceptance and
                            //   Implemented addenda
  corpusRunRefs,            // E2 + E3, per target profile
  claimAuditRefs,           // E4: candidate + promotion-tree audits
  consumerArmRefs,          // E5: diary/receipt evidence
  soakEvidence?,            // E6: { window: { start, end,
                            //   targetPopulation }, observationRefs,
                            //   journalExtractRef?, defectSearchRef };
                            //   absent only on the grandfathered route
  supportEvidenceRefs,      // E7, or the grandfather evidence manifest
                            //   when route = "grandfathered-direct.v1"
  authorAdjudication,       // E8: { date, adjudicator, record,
                            //   provenanceRef }
  promotionDate             // all dates UTC RFC 3339
}
```

Every `…Ref`/`…Refs` member is a closed evidence locator (or a list of
them), never a bare digest:

```text
{ path, sha256, schemaVersion, producer, sourceSha }
```

`path` is repo-relative; `sha256` is the artifact digest; `schemaVersion`
names the referenced artifact's own closed schema (`diary.v1` for prose
diary evidence); `producer` names the emitting suite or tool; `sourceSha`
is the revision that produced the artifact. A digest without a locator
cannot be reopened or interpreted; a locator that fails to resolve, or
resolves to different bytes, is a conforming validator's refusal (A2).

One artifact class needs its anchoring stated honestly rather than
circularly. An artifact produced from the staged promotion tree — E4's
promotion-tree audit — cannot record the promotion commit's SHA,
because that SHA depends on the receipt's own bytes. The staged-tree
rule: such an artifact's `sourceSha` is `candidateSourceSha`
(= `candidateParentSha`), and the artifact is anchored by that parent
plus its own `sha256`. The promotion commit's SHA is derivable post
hoc — it is the unique child of `candidateParentSha` whose tree holds
the receipt at its recorded digest — and once known it is recorded as a
dated follow-up line in the governing LLP's promotion addendum, a
documentation act after landing, never inside the receipt or any other
file the promotion commit carries.

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
behavior materially diverging from the governing contract.

Authority is grounded in LLP 0005, which grants no general unilateral
revision right over accepted designs — not even in the claim-reducing
direction. The split:

- **Support withdrawal** (the operational cut) stays immediate and
  needs no adjudication, as above — honesty never waits to stop
  *relying* on a claim.
- **The demotion proposal is a duty on discovery.** Any maintainer or
  agent who witnesses a trigger files the dated proposal — a draft
  `MaturityDemotionRecordV1` plus author notification — the day of
  discovery. Sitting silently on a known-suspect stable claim violates
  the honesty rules.
- **The demotion act** — flipping both registries and adding the
  governing-LLP addendum — is the author's adjudication, with one
  objective-trigger fast path: when the regression is witnessed by a
  failing committed gate — the id's mandatory support/conformance suite
  red at HEAD on a population profile, or A2 finding the promotion
  receipt cryptographically invalid (a digest or locator mismatch) — the
  discovering maintainer executes the demotion immediately, with
  same-day author notification. Subjective triggers — behavioral
  divergence, disputed materiality — always escalate and are never
  fast-path.

The fast path is a standing delegation in LLP 0130's shape, and this Spec
does not silently create it: it is proposed here, inside a commissioned
in-scope design, and takes effect only with the author's acceptance of
this document (§3). A fast-path demotion is recorded as such ("demoted
under LLP 0134 §6 fast path"), never presented as a fresh manual
adjudication — LLP 0130's honesty framing, in both directions. The
delegation is registry-visible and bounded: on acceptance, a dated
LLP 0130 revision row records the fast path as a standing decision
hosted at this §6, so the standing-decision registry never omits it;
the author may revoke it by dated revision of either document; and it
lapses automatically if this Spec is Superseded or Withdrawn.

The demotion commit mirrors §4: the record's `candidateSourceSha` is
the revision the trigger evidence is witnessed at (on the fast path,
the HEAD where the gate ran red or the receipt failed validation),
`candidateParentSha` is constrained equal to it and to the demotion
commit's sole parent — so A5's parent comparison is provable in both
directions — with exactly one transition per `parent..HEAD` range and
the same records root, in one dated commit carrying a conforming
`MaturityDemotionRecordV1` and a dated addendum in the governing LLP.
The record receives the same closed-schema treatment as the promotion
receipt — canonical JSON, closed members, A2 validation;
promotion and demotion files are distinguished by suffix
(`*.promotion.json` / `*.demotion.json`) under
`tests/acceptance/maturity/`:

```text
{
  schemaVersion: 1,
  capabilityIds,            // the atomic set, sorted
  fromMaturity: "stable",
  toMaturity: "experimental",
  triggerKind: "gate-regression.v1" | "receipt-invalid.v1"
             | "contract-divergence.v1",
  triggerEvidenceRefs,      // closed evidence locators (§4)
  candidateSourceSha,       // the revision the trigger evidence is
                            //   witnessed at
  candidateParentSha,       // == candidateSourceSha == the demotion
                            //   commit's sole parent (§4's pin, A5)
  voidedReceiptRef,         // closed evidence locator (§4) resolving
                            //   to the promotion receipt being voided
  authority: "author.v1" | "fast-path.v1",
  notifiedAuthorDate,
  demotionDate              // all dates UTC RFC 3339
}
```

Consequences are fail-closed:

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

Membership is two-legged — shipped acceptance AND demo use before
2026-07-30 — and both legs are witnessed in-tree per member. Shipped
acceptance: the conformance/registration suites landed 2026-07-27 for the
LLP 0108 pair and the seed pair and 2026-07-28 for bundle boot, all
pre-rule. Demo use: `inline_handler_v1` in the rerun diaries (Diary 0033
— Relay Board's board view and atomic move kept as inline handlers;
Diary 0039's colocated-inline-handlers row); `result_contract_v1`
acknowledged by five demo generated manifests (todo, todo-v2, rbac,
competitive-checkpoint, all-aboard:
`snapback/generated/functions.manifest.json`,
`acknowledgedExperimentalCapabilities`); `registered_bundle_boot_v1` by
the signal-desk real-adapter receipt
(`demos/signal-desk/acceptance/results/react-query-group.v1.json`,
2026-07-29: `generated-registered-bundle-boot` green with
`bootSource: "registered-bundle"`, retained evidence copies beside it) —
a receipt-witnessed demo adoption path rather than a manifest
acknowledgment; the seed pair by the fourteen demos carrying
`snapback/seed.json` plus Diary 0039's deterministic reset/seed row. Each
member is experimental today because its governing contract is not yet
Accepted — E1's necessary condition already fails.

Excluded, by name: `bounded_children_v1` and `write_activity_v1`.
Decision 3's letter arguably reaches them — the tree holds a passing
pre-rule *local* publication for exactly this pair (the embedded
`LocalRelationActivityPublicationV1` carrier with its pinned
qualification receipt, verified by
`local_relation_activity_publication_verified_for`; the registry test
asserts the pair is advertised on the local profile) — so this Spec
states plainly that decision 3 set an eligibility ceiling and the set
here is a deliberately stricter subset of it. The pair fails the subset
on three tree-true grounds: its hosted LLP 0113 §5 chain
(plan/confirm/provision/finalize, observation receipt, the LLP 0111
receipt vector) has never run; its demo-use leg fails E5's standard —
not for want of declarations (Signal Desk carries three real
`defineBoundedChildrenQuery` declarations in
`demos/signal-desk/snapback/functions.mjs`: `incidentTasks`,
`incidentComments`, `incidentActivity`) but because their only
consumers are the comparator fixtures and the acceptance harness,
while the demo's sole `defineWriteWithActivity` declaration is a
review-gated proving declaration its product adapter deliberately
bypasses — `write-with-activity.v1`'s existing-owner-only admission
made it "unusable by every anonymous rerun arm" (LLP 0120 open
question 5) — so the pair has no joint real production consumer
outside the acceptance corpus and comparator fixtures, and no
provenanced write arm at all; and CV-8 piece 1 already routes the
pair through the default path ("execute the 0113 path — yielding honest
experimental maturity"), whose first consumers they are (§8). A shipped
pre-rule local carrier alone confers nothing: membership requires both
legs. Also excluded is every id minted after 2026-07-30, so the set is
closed by construction and can only shrink.

The reserved act is the 0080 shape, not a waiver of honesty: it requires E1
(Accepted after the dual-family loop, then witnessed Implemented), E2–E5, E8,
and the §4 one-commit mechanics with `route: "grandfathered-direct.v1"` in
the receipt. Waived are E6 and E7's qualification lineage only — the
pre-rule shipped history substitutes, and it is bound, not gestured at:
before a member exercises the act, a closed per-member grandfather
evidence manifest (`<id>.grandfather.json` under the same records root,
A2-validated) binds the exact pre-cutoff commits, the acceptance-suite
and demo-use witnesses above as closed evidence locators, the
positive-predicate evidence, and `governingContractBaseline` — a full
closed evidence locator (§4), never a bare digest: `path` is the
governing LLP file; `sourceSha` names the baseline commit, the last
main-history commit with committer UTC date on or before 2026-07-30
that touched that file; and `sha256` is the SHA-256 of the file's
exact committed blob bytes at that commit. There is no extraction or
normalization step — "normative text" is not a digest concept;
materiality adjudication below, not the digest, filters evidence
notes. The reserved receipt's `supportEvidenceRefs` cites that
manifest.

Voiding is decidable against the baseline: a change exists exactly when
the governing LLP file's blob digest at the evaluation revision differs
from the baseline locator's `sha256`, and a post-2026-07-30 change
voids the member's reservation when the author adjudicates it
material; the
adjudicator is the author, at or before E8, and the adjudication is
recorded in the receipt or the governing-LLP addendum. Dated evidence
notes and diary annotations are categorically non-material (LLP 0108 and
LLP 0110 both carry 2026-07-30-dated evidence notes; they do not void).
Every void is recorded as a dated tombstone row appended to the table
above, so the printed set can never silently disagree with effective
membership. A voided surface has no promotion route until a dated
amendment gives its support authority a qualification path — fail-closed
on purpose. One standing decision is already aimed at this set: LLP 0130
SD-1 (omitted result contracts become a refusal when 0115's A+E slices
land) will land as a normative change in LLP 0108's family and may void
`result_contract_v1`'s — and possibly `inline_handler_v1`'s —
reservation by exactly this rule. That shrinkage is intended; the set
only shrinks.

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
  one-sided maturity flip fails CI. The mechanism is canonical-JSON
  emission compared in CI, never source scraping: a Rust test-mode
  emitter prints the sorted non-stable ids of `TargetCapabilityId::ALL`
  as canonical JSON, the codegen package exports its sorted experimental
  set the same way, and the check compares the two outputs byte-for-byte.
  (Deriving both registries from one canonical source would retire the
  mirror hazard entirely; that is future work, not assumed here.) This
  gate lands with this Spec's first implementation commit, before any
  promotion executes.
- **A2 — Record validation.** A committed validator parses every file
  under `tests/acceptance/maturity/` against the closed schema its suffix
  names — `*.promotion.json` (§4), `*.demotion.json` (§6),
  `*.grandfather.json` (§7), `*.soak-observation.json`,
  `*.soak-extract.json`, and `*.defect-search.json` (E6) — and refuses
  a file matching no suffix, unknown members, missing bar items for the
  declared route, an evidence locator that fails to resolve to its
  recorded bytes, a digest mismatch with the registry comments, a soak
  observation whose introducing commit's committer UTC date differs
  from its `dateUtc`, or duplicate/conflicting records for the same
  transition.
- **A3 — First-promotion shape.** The first executed promotion lands as one
  commit containing both registry changes, the updated tests, the conforming
  receipt, the governing-LLP addendum, and the guide/board rows — verified
  against the commit itself.
- **A4 — The gate's last witness.** The E3 acknowledgment-gate negative at
  the candidate revision is retained with the receipt.
- **A5 — No unreceipted or non-atomic flip.** Any maturity change in
  either registry without a same-commit conforming record violates this
  Spec, in either direction. A history-aware committed check makes the
  atomicity claim mechanical rather than aspirational: when a pushed
  range changes either registry's maturity assignment, CI identifies the
  transition commit, requires its sole parent to equal the record's
  `candidateParentSha` (= `candidateSourceSha`; §4's receipt for
  promotions, §6's record for demotions) — merge commits and
  stacked transitions are refused; exactly one transition per
  `parent..HEAD` range — derives the changed id set from the diff, and
  requires that same diff to contain the matching new record, both
  registry changes, the test updates, the governing-LLP addendum, and the
  guide/board rows. Final-tree tests, including the post-flip admission
  behavior, run on the transition commit itself, not only on its parent.
  A1 plus A2 cover the one-sided and malformed cases.

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
