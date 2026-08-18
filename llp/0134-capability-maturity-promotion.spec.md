# LLP 0134: Capability maturity promotion to stable

**Type:** Spec
**Status:** Accepted
**Systems:** Capability publication, Application data API, Relational queries, Code generation, Packaging, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-08-16 (lane split after four review cycles: D-4 promotion
across a source-to-parent range is deferred to
`issues/20260816-llp0134-d4-range-relaxation-needs-sound-derivation.md`;
promotion retains the exact-pin rule. The independently sound amendment parts
ship: E2 binds the id's own corpus across codegen's closed supporting-profile
population, E4(a) binds the candidate audit and `ref-check` to the declared
claim surface, and A5 binds both equal pins to the transition's actual sole
parent and verifies the landed tree.)
2026-08-07 (LLP 0189 cadence integration: E2 is scoped to the id's own corpus
at the candidate revision; E4(a)'s `ref-check` is claim-surface-scoped; the §6
fast path routes through D-1 tickets and the D-3 demotion window; E6's defect
corpus counts only claim-relevant D-1 tickets. Complete-battery automation is
the scheduled system-health backstop, not authority to advance a promotion
past its exact candidate pin.)
2026-08-03 (experimental-introduction correction: registration is
now an explicit `unregistered` → `experimental` act with a closed
`MaturityIntroductionRecordV1`, same-commit records for every future id, and
an exact four-transition historical backfill. This closes the record-vocabulary
gap without misrepresenting first registration as stable → experimental
demotion). 2026-08-02 (dated correction after the first implementation:
the promotion registry comment cites the exact promotion-record path plus
this Spec's §4 marker, not the receipt digest. A2/A5 already bind that
record's exact bytes, sole parent, changed ids, and complete self-excluding
landed tree; A5 now mechanically requires the closed path citation. This
removes the recorded receipt/comment digest cycle without weakening any
same-commit, parent, or tree check). 2026-08-02 (implementation record: the first process machinery
lands — exhaustive fail-closed Rust maturity assignment, canonical Rust/codegen
parity projection, the exact §7 reservation, closed record validation for all
six suffixes, digest replay, daily soak coverage, candidate-parent and
staged-tree pins, and history-aware promotion/demotion checks. One real
`inline_handler_v1` local observation starts the non-retroactive soak record;
committed acceptance separately exercises the real atomic
`bounded_children_v1` + `write_activity_v1` id set through complete promotion
and fast-path demotion fixtures. The
implementation pins the previously implicit population representation and
records one unresolved circularity below; no capability is promoted by this
landing). 2026-07-31 (ACCEPTED under LLP 0130 SD-4's standing
authorization: dual-family READY — Fable round 3, Codex round 5 —
with the three conditions checked and satisfied: (1) zero unresolved
MATERIAL concerns in either family's final round; (2) within the
decided scope of its commission (CV-8 piece 2 per decision 3; the
demotion fast-path standing delegation is this Spec's own in-scope
proposal, effective with this acceptance per its §3); (3) no evidence
boundary weakened — the promotion bar, receipts, and demotion
machinery are all additive evidence obligations, and SD-4 itself is
explicitly barred from covering maturity promotions. Recorded per
SD-4's honesty rule: the author's standing acceptance made in advance.
Review artifacts:
reviews/0134-capability-maturity-promotion.{fable,codex}.md.) 2026-07-31 (v0.2, round-1 dual-family review fixes — both
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
2026-07-31 (v0.4, round-3 review fixes —
`reviews/0134-capability-maturity-promotion.fable.md` round 3 READY,
three DETAILs C18–C20;
`reviews/0134-capability-maturity-promotion.codex.md` round 3 NOT
READY, MATERIAL residues N1/N2 plus MINOR D1. Merged and applied once
per item: E4(b)'s audited tree cryptographically bound — the receipt
gains `stagedTreeManifestSha256`, the digest of the canonical
self-excluding staged-tree manifest (sorted path→blob-SHA-256, the
receipt file's own path excluded), recomputed and exact-compared by
A5 on the transition commit (N1), with the post-hoc commit derivation
scoped to A5's validated landed-history transition instead of a
"unique child" graph claim (Fable C19); the three E6 evidence schemas
fully closed — outcome/materiality/disposition enums, element schemas
for `carrierDigests`, `familyEpochs`, `renewalRecordDigests`,
`scopes`, and `findings`, nonnegative counts with the
zero-withdrawal/expiry and zero-open-MATERIAL success predicates, and
A2-enforced cross-record equality binding `capabilityIds`,
`targetProfileId`, and the window to the receipt (N2); Signal Desk's
`defineWriteWithActivity` census corrected to two declarations, both
product-bypassed, conclusion unchanged (Codex D1 = Fable C18); the
committed-prose locator tokens `llp-blob.v1`/`git` defined for
`governingContractBaseline` (C20).)
2026-07-31 (v0.5, round-4 review fix —
`reviews/0134-capability-maturity-promotion.codex.md` round 4 NOT
READY on exactly one item: N1, D1, and the locator tokens RESOLVED,
N2's population-coverage residue MATERIAL. Applied as specified:
`journalExtractRef` → `journalExtractRefs`, plural, exactly one
successful extract per enumerated hosted deployment identity in the
window; E6's local witness and A2's refusal clause both made
cell-complete — a green observation for every local
`targetProfileId × UTC-day` cell of the window, every enumerated
local profile on every day, any uncovered cell failing E6 — with the
day-gap reset rule restated as the same cell rule.)
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

- the Rust registry, `TargetCapabilityId::maturity` in `crates/snapback/src/manifest.rs`,
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

`unregistered` is not a third maturity value. It is the history checker's name
for absence from the closed registry before the commit that first assigns the
id `experimental`. That **introduction act** uses a canonical
`*.introduction.json` file under `tests/acceptance/maturity/` with the closed
`MaturityIntroductionRecordV1` shape:

```text
{
  schemaVersion: 1,
  route: "default.v1",
  recordingMode: "same-commit.v1" | "historical-backfill.v1",
  capabilityIds: string[],
  fromMaturity: "unregistered",
  toMaturity: "experimental",
  governingLlp: repo-relative path,
  candidateSourceSha: git SHA,
  candidateParentSha: git SHA,
  introductionDate: UTC timestamp,
  historicalTransitionCommit?: git SHA,
  backfillIssue?: repo-relative path
}
```

`capabilityIds` is sorted, unique, non-empty, and preserves §1's coupled sets.
Both candidate pins equal the introduction commit's sole parent;
`introductionDate` equals its committer time normalized to UTC; and the commit's
projection delta adds exactly those ids and removes none. The normal
`same-commit.v1` mode omits both optional members. It lands the record, both
source registries, the canonical full-registry projection, a non-projection
maturity/admission test, the governing LLP, and the guide/program-board rows
together. The checker derives introduction versus demotion from the id's
absence or presence in the parent full-registry projection; the record cannot
choose its own direction. This is default-route registration, not a promotion
and not a support claim. A full-registry addition without the identical
experimental-projection addition is refused, so a newly minted id cannot enter
at stable by omitting the introduction record.

The `historical-backfill.v1` mode exists only for the four already-landed
transitions below. It requires both optional members, fixes `backfillIssue` to
`issues/closed/20260803-maturity-transition-records-missing.md`, and admits no
other commit, id set, or governing LLP. The post-hoc record is the only waived
same-commit item. Because the immutable commits cannot acquire files, the
checker also accepts the source-registry and documentation split actually
landed in this closed set: at least one source registry and one non-projection
test changed in the transition, while the governing LLP already existed at the
transition. Sole-parent, candidate-pin, exact added-id delta, exact timestamp,
governing-document existence, and ancestry of the later record remain
mechanical requirements.

| Transition commit | Sole parent | Capability ids | Governing LLP |
| --- | --- | --- | --- |
| `eaecfb3a8e8a04cd7c74c528f5a54b3b08ceacba` | `26c43b86a845c6f8ed252eabe7f9d92c5f5ccacd` | `sequence_allocation_v1` | LLP 0135 |
| `353fd7467a906ea8f2ae3b598598b41c4a658525` | `708ce295f2b591c0a9c81d5357ed63f094a169dc` | `snapshot_batch_v1` | LLP 0135 |
| `3bea0bbb5da78e7ee0f59087a911272dae821fd4` | `cbae493241b2858b07c865d809b888537c1e452b` | `live_full_text_search_v1` | LLP 0136 |
| `79b7f6189e5cd635e0167bc2adf52c51a5c2226e` | `9a1029224d636141c97e7dc1b89dbc5a5d9de8c8` | `vector_search_v1` | LLP 0132 |

The audit corrects the triggering issue's preliminary census:
`live_full_text_search_v1` was also missing a record, while
`vector_search_v1` entered the projection in `79b7f618`, not in the later
implementation commit `532d56ee`.

Ids that publish as one atomic claim family (the relation/activity pair
`bounded_children_v1` + `write_activity_v1`, LLP 0110 §Hosted union carrier)
promote, and demote, together: one receipt, one commit. Their evidence is
shared; a split promotion would claim what was never separately witnessed.
The rule follows the evidence, not only the wire carrier: the seed pair
`versioned_seed_install_v1` + `versioned_seed_reset_v1` is advertised only
after one closed mandatory suite passes every local row (the registry gate
in `crates/snapback/src/manifest.rs` carrying `@ref LLP 0109`), so its evidence is
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
`candidateParentSha`, its own digest, and the receipt's staged-tree
manifest digest (§4's staged-tree rule); E8 is the author's dated
act. A
missing or vacuous item refuses the promotion; there is no partial credit.

- **E1 — Governing-contract standing.** The id's governing LLP is Accepted
  after a dual-family LLP 0005 loop and has reached Implemented with every
  §Acceptance item witnessed, receipts retained. A Draft or Review contract
  cannot promote, and acceptance alone is not the exit: `experimental`
  persists until the contract is Accepted, witnessed Implemented, and the
  id explicitly promoted under a route here (the `CapabilityMaturity`
  vocabulary in `crates/snapback/src/manifest.rs`; LLP 0080's ids stayed experimental
  after its 2026-07-24 acceptance until the Implemented witnesses landed
  2026-07-26).
- **E2 — Acceptance-corpus breadth.** The promoted id's own acceptance
  corpus reruns green at the candidate revision on every target profile —
  drawn from the closed profile list, codegen's `TARGET_PROFILES` — whose
  support predicate is true; that scoped rerun is not inheritable from an
  older revision. Corpus rows unrelated to the promoted id are carried by
  the scheduled complete battery instead (LLP 0189 D-6, 2026-08-07
  re-scope): unrelated root reds are ticketed by that scheduled automation
  and do not substitute for or widen the id's own candidate corpus. GAP rows
  on non-supporting targets are honest GAPs, not breadth.
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
  --verbose` is green on the id's claim-relevant surface (LLP 0189 D-4
  scope — registries, the id's generated artifacts and guide rows, its
  governing document); whole-repo `ref-check` health is carried by the
  scheduled battery (LLP 0189 D-6), so an unrelated annotation
  landing elsewhere in the tree does not invalidate the candidate. (b) The promotion-tree audit, on the staged
  promotion tree — the exact tree the promotion commit will carry:
  every authoritative registry, guide, and document statement reflects
  stable and no stale authoritative experimental reference survives,
  while historical generated acknowledgments remain explicitly
  permitted (§5). Its receipt is itself carried by the promotion
  commit, so it anchors on `candidateParentSha` plus its own content
  digest, and its locator's `sourceSha` is `candidateSourceSha` (§4's
  staged-tree rule); the tree it audited is bound whole by the
  receipt's staged-tree manifest digest, which A5 recomputes on the
  transition commit and exact-compares, proving the audited staged
  tree and the landed tree byte-identical (§4's staged-tree rule,
  A5). Both receipts are E4 evidence.
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
    (LLP 0113 §4.2) — exported as digest-bound
    `MaturitySoakJournalExtractV1` extracts (*Evidence records* below),
    exactly one successful extract per enumerated hosted deployment
    identity in the window, each showing family-epoch continuity with
    zero withdrawals and zero expiries. An enumerated hosted identity
    with no successful extract, or with more than one, fails E6.
  - *Witness, local.* Local support lives in ephemeral processes that
    re-derive the fact at each start from the embedded carrier, so
    continuity is witnessed by dated support-verification runs, and
    coverage is per cell: for every enumerated local population
    profile and every UTC calendar day of the window, at least one
    green run on that profile that day executes the id's mandatory
    support suite — the same closed suite whose green rows gate the
    registered fact; for the 0110 pair, the embedded-carrier and
    qualification-receipt verification — at the then-current main HEAD
    and emits a conforming `MaturitySoakObservationV1` receipt
    (*Evidence records* below) binding profile, date, HEAD SHA,
    carrier/receipt digests, and outcome, retained under §4's records
    root. A `targetProfileId × UTC-day` cell with no green observation
    is a coverage gap, and any uncovered cell fails E6.
  - *Disqualifiers and reset.* Any support-fact regression on a
    population member, claim-family withdrawal, maturity demotion of
    the id, coverage gap — an uncovered local
    `targetProfileId × UTC-day` cell (*Witness, local*'s cell rule) —
    or population loss resets the window start, as does a MATERIAL
    defect against the id's contract open at any point in the window
    (MATERIAL in the review-severity sense the LLP 0005 loop artifacts
    use). The defect corpus is closed: open filesystem tickets
    under `issues/` (not `issues/closed/`), Linear issues in the Exact
    project with the Snapback label naming the id or its governing LLP,
    and the governing LLP's defect ledger where the LLP 0076/0077
    convention applies. LLP 0189 D-1 battery tickets count only when
    their failing gate is claim-relevant to the id (D-4 scope), and a
    D-1 ticket opened and resolved fix-forward inside the window is not
    a reset. The dated search over exactly these scopes is
    retained as a `MaturityDefectSearchV1` record (*Evidence records*
    below) and bound as `soakEvidence.defectSearchRef`.
  - *Rerun.* At least one full E2+E3 rerun inside the window.
  - *Evidence records.* Each E6 evidence class is a closed
    canonical-JSON document with its own suffix under §4's records
    root, A2-validated like every other maturity record: unknown
    members refused, every count a nonnegative integer, every enum
    closed.
    `MaturitySoakObservationV1` (`*.soak-observation.json`):
    `{ schemaVersion: 1, capabilityIds, targetProfileId, dateUtc,
    headSha, suiteProducer, carrierDigests, outcome }` — one per
    local observation day. `outcome` is the closed enum
    `"green" | "red"`; only a green observation credits its day, and
    a committed red one is a witnessed support-fact regression
    (*Disqualifiers and reset*). `carrierDigests` entries are
    `{ path, sha256 }` pairs — `path` repo-relative at `headSha`,
    `sha256` over that file's exact bytes — at least one entry. An
    observation is credited only when the commit introducing it
    carries a committer UTC date equal to its `dateUtc` (A2 refuses
    the mismatch), so a window cannot be back-fabricated by rerunning
    the suite at historical HEADs after the fact.
    `MaturitySoakJournalExtractV1` (`*.soak-extract.json`):
    `{ schemaVersion: 1, capabilityIds, claimFamily,
    deploymentIdentity, window, familyEpochs, renewalRecordDigests,
    withdrawalCount, expiryCount }` — the hosted journal extract.
    `claimFamily` names a member of LLP 0113 §4's closed family
    union. `familyEpochs` entries are `{ epoch, firstRenewalUtc,
    lastRenewalUtc }`, `epoch` a nonnegative integer, entries sorted
    ascending by `epoch` and jointly covering the window with no
    gap. `renewalRecordDigests` entries are SHA-256 digests of the
    journal's canonical renewal-record bytes (LLP 0113 §4.2), one
    per journaled renewal in journal order, at least one entry. The
    success predicate is `withdrawalCount == 0` and
    `expiryCount == 0`; a nonzero count is a witnessed disqualifier
    and A2 refuses the extract as E6 evidence.
    `MaturityDefectSearchV1` (`*.defect-search.json`):
    `{ schemaVersion: 1, capabilityIds, governingLlp, searchDateUtc,
    scopes, findings }` — the defect search. `scopes` entries are
    drawn from the closed tokens `"issues.v1"`,
    `"linear-exact-snapback.v1"`, and `"llp-defect-ledger.v1"`, each
    at most once; the first two are mandatory, the third mandatory
    exactly when the governing LLP carries an LLP 0076/0077-style
    defect ledger. `findings` entries are
    `{ scope, ref, materiality, disposition }`: `scope` one of the
    scope tokens, `ref` that scope's stable identifier (ticket path,
    Linear issue key, or ledger row), `materiality` the closed enum
    `"material" | "minor"` (the review-severity sense), and
    `disposition` the closed enum
    `"open-in-window" | "not-open-in-window"`. The success predicate
    is zero findings both `"material"` and `"open-in-window"`;
    `searchDateUtc` must not precede the window end, so the search
    observes the whole window; A2 refuses a violation of either.
    *Cross-record constraints, A2-enforced:* every observation's,
    extract's, and search's `capabilityIds` equals the receipt's
    `capabilityIds` exactly; each observation's `targetProfileId` is
    a member of `soakEvidence.window.targetPopulation` and its
    `dateUtc` lies inside the window; population coverage is
    complete — for every enumerated local population profile and
    every UTC day of the window, `observationRefs` resolves a green
    observation for that `targetProfileId × UTC-day` cell, and any
    uncovered cell fails E6; every extract's `window` equals the
    receipt's `soakEvidence.window` and its `deploymentIdentity` is
    an enumerated population member, and `journalExtractRefs`
    resolves exactly one successful extract per enumerated hosted
    deployment identity — an identity with none, or more than one,
    fails E6; the search's `governingLlp` equals the receipt's
    `governingLlp`. `soakEvidence`'s `observationRefs`,
    `journalExtractRefs`, and `defectSearchRef` are closed evidence
    locators (§4) whose `schemaVersion` values name exactly these
    schemas: `soak-observation.v1`, `soak-extract.v1`,
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
   to the stable arm in `crates/snapback/src/manifest.rs`, with a dated comment citing this
   Spec and the exact repo-relative promotion-record path, and carrying the
   closed `@ref LLP 0134#4-the-promotion-act` annotation defined below;
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
   the commit message; the registry comment locates the same record by its
   exact path while A2/A5 bind its bytes and transition commit;
5. adds a dated promotion addendum to the id's governing LLP recording the
   act, the receipt digest, and the adjudication; and
6. updates the guide capability index row and any program board row in the
   same commit (LLP 0130's board-lockstep lesson).

The registry citation has one closed, mechanically validated spelling, where
`YYYY-MM-DD` is `promotionDate`'s UTC date and `<path>` is the receipt's exact
repo-relative path:

```text
@ref LLP 0134#4-the-promotion-act — promoted YYYY-MM-DD via <path>
```

It deliberately carries no receipt digest. A2 resolves and digest-checks the
receipt's locators; A5 identifies the receipt introduced by the transition,
binds it to the exact changed ids and sole parent, and recomputes the complete
self-excluding landed-tree digest. Duplicating the receipt digest in a file
inside that digest domain added a cycle, not evidence. A5 refuses a promotion
whose `crates/snapback/src/manifest.rs` lacks the exact citation marker.

The promotion commit lands as a sole-parent commit: no merge commit, no
stacked promotions, exactly one maturity transition per `parent..HEAD`
range (A5). The candidate binds `candidateSourceSha` as its qualification
commit, and `candidateParentSha` is constrained equal to it and to the
promotion commit's actual sole parent. If `main` advances after qualification,
the candidate must be re-declared and its candidate evidence re-emitted at the
new parent. Advancing across a commit range is deferred design work; a receipt
scope or earlier receipt cannot waive this exact-pin rule. A5 compares both
pins against the actual parent, so the receipt never needs to name its own
commit.

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
                            //   commit's actual sole parent
  claimScope,               // LLP 0189 D-4 roots/files for this id
  reviewJournalRefs,        // E1: review artifacts, acceptance and
                            //   Implemented addenda
  corpusRunRefs,            // E2 + E3, per target profile
  claimAuditRefs,           // E4: candidate + promotion-tree audits
  stagedTreeManifestSha256, // E4(b): digest of the canonical
                            //   self-excluding staged-tree manifest
                            //   (the staged-tree rule below; A5
                            //   recomputes and exact-compares)
  consumerArmRefs,          // E5: diary/receipt evidence
  soakEvidence?,            // E6: { window: { start, end,
                            //   targetPopulation }, observationRefs,
                            //   journalExtractRefs?, defectSearchRef };
                            //   exactly one successful extract per
                            //   enumerated hosted deployment identity;
                            //   absent only on the grandfathered route
  supportEvidenceRefs,      // E7, or the grandfather evidence manifest
                            //   when route = "grandfathered-direct.v1"
  authorAdjudication,       // E8: { date, adjudicator, record,
                            //   provenanceRef }
  promotionDate             // all dates UTC RFC 3339
}
```

`claimScope` is
`{ schemaVersion: "snapback.maturity-claim-scope.v1", roots, files }`, with
sorted unique repo-relative paths and a non-empty combined surface.
It records the named-author-accepted evidence classification at the exact
candidate parent; it is not authority to reuse that evidence at a later parent.

Each `corpusRunRefs` locator resolves to a closed
`snapback.maturity-own-corpus-run.v1` record naming exactly the promoted
`capabilityIds`, one target profile, `status: "green"`, and the SHA-256 of the
canonical `claimScope`. Profiles are drawn from codegen's shared closed
`TARGET_PROFILE_DEFINITIONS`; the receipt has exactly one corpus record for
every profile whose capability manifest at `candidateSourceSha` supports the
whole promoted set, with no invented or duplicate profile.

The candidate member of `claimAuditRefs` resolves to a closed
`snapback.maturity-claim-audit.v1` record. Its capability set and `claimScope`
exact-match the promotion receipt, and its `refCheck` member records command
`./ref-check --verbose`, `status: "green"`, and the same exact scope. These E2
and E4(a) bindings are evidence checks at one exact parent; they do not derive
authority for a source-to-parent range. The independently code-derived scope
needed to make such a range sound is deferred to the 2026-08-16 issue above.

Every `…Ref`/`…Refs` member is a closed evidence locator (or a list of
them), never a bare digest:

```text
{ path, sha256, schemaVersion, producer, sourceSha }
```

`path` is repo-relative; `sha256` is the artifact digest;
`schemaVersion` names the referenced artifact's own closed schema
(`diary.v1` for prose diary evidence; `llp-blob.v1` for committed LLP
prose bound as exact blob bytes — the `governingContractBaseline`
case); `producer` names the emitting suite or tool, and is `git` for
committed-blob evidence no suite emitted; `sourceSha` is the revision
that produced the artifact. A digest without a locator
cannot be reopened or interpreted; a locator that fails to resolve, or
resolves to different bytes, is a conforming validator's refusal (A2).

One artifact class needs its anchoring stated honestly rather than
circularly. An artifact produced from the staged promotion tree — E4's
promotion-tree audit — cannot record the promotion commit's SHA,
because that SHA depends on the receipt's own bytes. The staged-tree
rule: such an artifact's `sourceSha` is `candidateSourceSha`
(= `candidateParentSha`), and the artifact is anchored by that parent plus its
own `sha256`. The parent and the artifact's bytes do not by
themselves bind the *tree* the audit claims to have covered, so the
tree is bound whole: the receipt's `stagedTreeManifestSha256` is the
SHA-256 of the canonical staged-tree manifest — the canonical-JSON
array of `[path, sha256]` pairs, sorted bytewise by repo-relative
path, one pair per file in the staged promotion tree, each `sha256`
over that file's exact bytes, with exactly one path excluded: the
receipt file's own. The self-exclusion breaks the circularity — the
manifest is computed over the finished staged tree minus the receipt
(including the already-final path-based registry citation), its digest is
written into the receipt, and the receipt then joins
the tree — and A5's transition-commit run recomputes the landed
tree's manifest by the same rule (same exclusion, same ordering, same
serialization) and exact-compares the digest, so the audited staged
tree and the landed tree are provably byte-identical. The promotion
commit's SHA remains derivable post hoc, scoped to landed main
history: it is the transition commit A5 identifies for the pushed
range — uniqueness there is A5's admission rule, exactly one
transition per `parent..HEAD` range, not a git-graph invariant, since
an abandoned side-ref attempt may share the parent and carry receipt
bytes — and once known it is recorded as a dated follow-up line in
the governing LLP's promotion addendum, a documentation act after
landing, never inside the receipt or any other file the promotion
commit carries.

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
  red on a population profile in the scheduled battery (routed through its
  LLP 0189 D-1 signature-keyed ticket, which filters transient
  concurrent-landing reds), or A2 finding the promotion receipt
  cryptographically invalid (a digest or locator mismatch) — the
  discovering maintainer executes the demotion within LLP 0189 D-3's
  one-battery-period window, with same-day author notification. Subjective triggers — behavioral
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
while the demo's two `defineWriteWithActivity` declarations —
`addTaskWithActivity`, the review-gated proving declaration, and
`toggleTaskWithActivity`, an acceptance-only closed profile — are
both deliberately bypassed by its product adapter —
`write-with-activity.v1`'s existing-owner-only admission made the
proving declaration "unusable by every anonymous rerun arm" (LLP 0120
open question 5) — so the pair has no joint real production consumer
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
that touched that file; `sha256` is the SHA-256 of the file's exact
committed blob bytes at that commit; and its `schemaVersion` and
`producer` are `llp-blob.v1` and `git` (§4's committed-prose
tokens). There is no extraction or
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
  emitter prints both all ids and the sorted non-stable ids of
  `TargetCapabilityId::ALL` as canonical JSON. The full set is compared with
  `tests/acceptance/capability-registry.ids.json`; the codegen package exports
  its sorted experimental set, and the non-stable outputs plus
  `tests/acceptance/capability-maturity.experimental.json` are compared
  byte-for-byte.
  (Deriving both registries from one canonical source would retire the
  mirror hazard entirely; that is future work, not assumed here.) This
  gate lands with this Spec's first implementation commit, before any
  promotion executes.
- **A2 — Record validation.** A committed validator parses every file
  under `tests/acceptance/maturity/` against the closed schema its suffix
  names — `*.introduction.json` (§1), `*.promotion.json` (§4),
  `*.demotion.json` (§6),
  `*.grandfather.json` (§7), `*.soak-observation.json`,
  `*.soak-extract.json`, and `*.defect-search.json` (E6) — and refuses
  a file matching no suffix, unknown members, missing bar items for the
  declared route, an evidence locator that fails to resolve to its
  recorded bytes, a soak
  observation whose introducing commit's committer UTC date differs
  from its `dateUtc`, an E6 record violating its closed enums, element
  schemas, count constraints, success predicates, or cross-record
  constraints (E6 *Evidence records*), an E6 evidence set with
  incomplete population coverage — any local
  `targetProfileId × UTC-day` cell of the window without a green
  observation, or any enumerated hosted deployment identity without
  exactly one successful journal extract — or duplicate/conflicting
  records for the same transition. For a promotion, A2 also validates the
  closed `claimScope`, requires E2 evidence to bind its digest and the exact
  supporting target-profile population, requires E4(a)'s candidate audit and
  `ref-check` to exact-match it, and refuses unequal candidate pins before
  trusting any of that evidence.
- **A3 — First-promotion shape.** The first executed promotion lands as one
  commit containing both registry changes, the updated tests, the conforming
  receipt, the governing-LLP addendum, and the guide/board rows — verified
  against the commit itself.
- **A4 — The gate's last witness.** The E3 acknowledgment-gate negative at
  the candidate revision is retained with the receipt.
- **A5 — No unreceipted or non-atomic transition.** Any maturity change in
  either registry without a same-commit conforming promotion/demotion record,
  or any first registration at experimental without §1's conforming
  introduction record, violates this Spec. The only post-hoc records are the
  four closed §1 backfills. A history-aware committed check makes the
  atomicity claim mechanical rather than aspirational: when a pushed
  range changes either registry's maturity assignment, CI identifies the
  transition commit, requires its sole parent to equal the record's
  `candidateParentSha` and `candidateSourceSha` (§4's receipt for promotions,
  §6's record for demotions, or §1's introduction record) — merge
  commits and stacked transitions are refused; exactly one transition per
  `parent..HEAD` range — derives the changed id set from the diff, and
  requires that same diff to contain the matching new record, both
  registry changes, the test updates, the governing-LLP addendum, and the
  guide/board rows, subject only to §1's closed historical-backfill exception.
  An experimental addition resolves to exactly one introduction or demotion
  record, so registration cannot be mistaken for rollback. Final-tree tests,
  including the post-flip admission
  behavior, run on the transition commit itself, not only on its parent.
  For promotions, that run also requires `crates/snapback/src/manifest.rs` to contain the
  exact dated §4 promotion-record citation defined above, then recomputes the
  landed
  tree's canonical self-excluding staged-tree manifest (§4's
  staged-tree rule) and exact-compares its digest against the
  receipt's `stagedTreeManifestSha256`; a mismatch refuses the range —
  the landed tree is not the tree E4(b) audited. A1 plus A2 cover the
  one-sided and malformed cases.

This Spec's own Review → Accepted transition may ride LLP 0130 SD-4 if it
converges dual-family READY with zero unresolved MATERIAL concerns, within
its decided scope, weakening no evidence boundary — recorded per SD-4. Its
§Acceptance items gate Implemented as usual.

## Implementation record — 2026-08-02

The first implementation lands the process authority without promoting a
capability. `TargetCapabilityId::maturity` remains the sole runtime authority,
but its former `_ => Stable` judgment default is gone: all ids are assigned
exhaustively, so adding an id without choosing a maturity fails compilation.
Codegen's mirror now includes every Rust non-stable id and exports a sorted
canonical-JSON projection; `crates/snapback/tests/capability_v0.rs` compares that emission
byte-for-byte with Rust and with the committed history projection at
`tests/acceptance/capability-maturity.experimental.json`. The five §7 ids are
also a closed Rust eligibility set whose members remain experimental.

`scripts/capability-maturity.mjs` implements A2 and A5 for all six originally
defined record suffixes. It rejects unknown members and suffixes,
non-canonical bytes,
unresolvable or mismatched locators, incomplete local day cells, hosted
identity/extract mismatches, open MATERIAL findings, invalid grandfather
baselines, late fast-path notifications, non-atomic registry diffs, wrong
candidate parents, stacked transitions, missing code/test/doc/guide/board
companions, and a promotion tree whose recomputed self-excluding manifest does
not equal `stagedTreeManifestSha256`. `tests/capability-maturity.test.mjs`
constructs a real git history for the atomic
`bounded_children_v1` + `write_activity_v1` set: fourteen daily observations,
a default-route promotion, a committed gate regression, and a fast-path
demotion. The ordinary local proof runs both that acceptance and the validator.

Two schema seams were implicit in the accepted prose and are pinned here so
independent producers do not choose incompatible shapes:

- `soakEvidence.window.targetPopulation` is the closed object
  `{ localProfileIds, hostedDeployments }`; `localProfileIds` is a sorted,
  unique, non-empty array, and `hostedDeployments` is a sorted unique array of
  `{ targetProfileId, deploymentIdentity }`. This makes the local
  `profile × UTC-day` cells and hosted one-extract-per-identity population
  mechanically distinguishable.
- `MaturityGrandfatherEvidenceV1` is the closed per-member object
  `{ schemaVersion, capabilityIds, cutoffDate, preCutoffCommitRefs,
  acceptanceSuiteRefs, demoUseRefs, positivePredicateRefs,
  governingContractBaseline }`; `cutoffDate` is exactly `2026-07-30`. For an
  A5 demotion, the governing LLP is recovered from the closed
  `voidedReceiptRef`, because `MaturityDemotionRecordV1` has no duplicate
  `governingLlp` member.

The 2026-08-02 dated correction above closes the implementation record's one
known construction blocker. The registry comment now cites the exact promotion
record path and §4 marker, never the receipt digest. The staged-tree manifest is
therefore constructible in one pass over the finished tree excluding only the
receipt; then the receipt receives that digest and joins the commit. A5
mechanically validates the exact dated path citation as well as the existing
same-commit record, changed id set, sole parent, and complete landed-tree
binding. `tests/capability-maturity.test.mjs` exercises that construction and
refuses a transition whose registry citation is absent.

The first retained production-tree observation is
`tests/acceptance/maturity/inline-handler-local-dev-2026-08-03.soak-observation.json`,
emitted after `inline-result-contracts.test.mjs` passed against candidate
`55971c8b25d34a5f75d920f25debe55458332807`. The intended relation/activity
pair could not start its window: its mandatory publication suite found the
committed `crates/snapback/src/local.rs` digest had drifted from the source-owned carrier on
that candidate. Issue
`20260802-relation-activity-publication-carrier-drift` retains the exact
failure; no green observation was fabricated.

## Implementation correction — 2026-08-03

The record tree now has a seventh closed suffix, `*.introduction.json`, and
the range validator resolves an experimental projection addition against
the Rust-derived full-registry history projection before requiring exactly one
introduction or demotion record, instead of calling every addition a demotion
or trusting the record to choose its direction. Same-commit introduction
fixtures prove the forward path. Four canonical historical records bind the
closed §1 table; arbitrary backfills fail closed. Explicit one-transition
ranges over sequence allocation, snapshot batch, live full-text search, and
vector search now validate their real `unregistered` → `experimental` history.

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

**Accepted (2026-07-31)** under LLP 0130 SD-4's standing authorization, as
recorded in the metadata header and review artifacts. This document specifies
the promotion path; acceptance claims and promotes no capability maturity by
itself. The paragraph below is retained as the pre-acceptance record.

Originally **Draft**: authored 2026-07-31 as LLP 0115 CV-8 piece 2 under its
execution ticket (`issues/20260731-cv8-piece2-stable-promotion-design.md`),
within the program LLP 0130 governs.
