# LLP 0162 scoped re-read + LLP 0163-0165 extraction review — Fable family

## Combined light round — 2026-08-03 (targets: 0162 v0.9 SHA-256 54e2e686…, 0163 96e1b62b…, 0164 a2d1afe2…, 0165 af90ffdf…; tree at f0c2fd53)

**Reviewer family:** Claude (Fable 5)
**Provider / runtime:** Claude Code subagent (Explore), fresh non-author context
**Date:** 2026-08-03
**Redacted:** no
**Method:** single light cross-family round after LLP 0162's acceptance, per the round-7 reviews' prescription: scoped re-read of the unreviewed v0.8 contracts, extraction-fidelity check of the OQ14 Specs, and accuracy check of the five dated amendments. Capsule barred re-litigating the converged architecture and the explicitly deferred content, and barred llp/reviews/. Recorded verbatim below (full text as received; see the companion codex artifact for the other family).

---

## 1. Overall assessment

All four target SHA-256 hashes verify against the working tree at `f0c2fd53`, and the scoped re-read finds the converged architecture holding up well: the v0.8 repairs are, in substance, real repairs rather than the fix-introduces-defect pattern earlier rounds kept catching. The tombstone-plus-lookup-precedence construction genuinely closes the two-identities-in-one-epoch hole without weakening LLP 0043's never-evict rule; the write-authority choke point is a real derivation with an honest fallback class rather than a renamed assertion; the checkpoint re-scope to `verifiedCopyFidelity` correctly preserves LLP 0081's predecessor-derived distinction instead of laundering copy fidelity into proof; the LLP 0158 publication import and its registry-authority deviation are accurately stated against 0158's actual local-evidence-only recovery posture; and the approved-facts re-seal is consistent with Accepted LLP 0097 §5, which already conditions renewed approval on divergence. Extraction fidelity is good in the main: the three Specs are explicitly summary-plus-artifact-ownership with 0162 retained as the detail authority and the divergence rule pointed in the safe direction (the Spec is the defect), so the usual dropped-constraint risk of extraction mostly dissolves. What I did find is a genuine soundness gap in the widened identity contract — the acknowledgement machinery the epoch protocol is built on has no host-originator counterpart, and the core-tier promotion identity is explicitly host-originated — plus a cluster of seam defects created by the extraction and amendment edits themselves: a broken §8 table, an amendment that drops a disposition 0162 twice assigns to it, two amendments each claiming sole ownership of the same parameters, and acceptance-row/ownership mappings that do not close over §4.

## 2. Verdict — CLEAN / DEFECTS FOUND

- **0162-delta (v0.8 contracts in scope):** DEFECTS FOUND — one MAJOR (host-originator acknowledgement gap in §1's epoch/reclamation protocol), plus §8's per-component table broken by the v0.9 edit and a conditional-fairness term omitted in §5.
- **LLP 0163:** DEFECTS FOUND — faithful in substance, but it inherits the MAJOR by restating the range-based closure predicate verbatim, and its Open item 3 reopens a disposition three same-dated amendments already made normative.
- **LLP 0164:** DEFECTS FOUND — highest-fidelity of the three; defects are seam-level (dual claim on §4 with no cross-Spec precedence, row 13 dropped, one dropped epoch-governance clause).
- **LLP 0165:** DEFECTS FOUND — owns the write-authority choke point while claiming no acceptance row that gates it, and asserts a step-0/golden-vector coupling not traceable to 0162.
- **Amendments (0097/0133/0043/0012/0095):** DEFECTS FOUND — 0012 and 0095 are accurate; 0043 omits `identity-horizon-passed`, 0133 and 0043 conflict on parameter ownership, and 0097 lands three of the four scope items 0162 §8 declares for it.

## 3. Findings

1. **MAJOR — 0162 §1 (carried into 0163) — the epoch-closure and reclamation protocol is defined entirely in terms of an acknowledgement that host-originated identities have no way to produce, and the core-tier promotion identity is host-originated.** The whole lifecycle is acknowledgement-gated: reclamation "applies only to receipts already acknowledged, or removed by an operator purge", closure requires "every identity in its preallocated ranges is admitted-and-**acknowledged**", and the safety argument is explicitly client-shaped — "the acknowledging client already observed the outcome". In LLP 0043 acknowledgement is a client protocol act with no host analogue. But §1 widens the identity to host originators whose identities are *derived*, not drawn from a preallocated range, and then says "Host-originated epochs are issued by the server's own incarnation and close on incarnation rotation under the same rules" — rules whose closure predicate quantifies over preallocated ranges that host epochs do not have, and whose reclamation gate no host actor can satisfy. This is not merely academic: the aggregate promotion identity is "server-minted at first admission … governed by the host-originator epoch protocol", and branch promotion is inside the initial coverage target and inside `AgentSafeV1-core`. Safety survives — lookup precedence returns the surviving suppression record before the floor, so no silent duplicate — but liveness does not: promotion (and cron/job/migration, once conformance maps those lanes) accumulates permanently unreclaimable suppression records until refuse-at-capacity denies admission of new promotion identities, and Acceptance 2's "including a host-initiated retry after a crash" is gated on a floor that can never legitimately advance. LLP 0163 restates the predicate faithfully and therefore inherits the gap, and makes host-epoch closure vacuous by construction (no ranged identities). **Resolution:** define a host-originator acknowledgement (or an explicit substitute reclamation predicate — e.g. terminal-receipt-plus-declared-window for server-authenticated identities, since there is no remote party whose observation must be protected) in a dated 0162 revision and in 0163's Suppression-lifecycle and Epochs bullets, and state closure for range-less host epochs explicitly rather than by "the same rules". Add an Acceptance 14 leg covering host-identity reclamation and host-epoch closure.

2. **MATERIAL — 0162 §8 — the v0.9 OQ14 paragraph was inserted into the middle of the per-component provenance table, orphaning six of its ten rows.** The extracted-Specs paragraph interrupts the table; under CommonMark/GFM the six resumed lines render as literal pipe text. The lost rows are exactly the ones carrying §8's core-provenance argument. **Resolution:** move the paragraph below the table. Mechanical; no semantic change.

3. **MATERIAL — LLP 0043 amendment — it omits `identity-horizon-passed`, which 0162 §1 twice assigns to it by name.** The landed amendment covers the affirmations, tombstones, `result-expired`, and offline ranges, but never mentions `identity-horizon-passed` or the per-audience epoch floor as a retention rule. 0012 and 0095 carry it correctly. **Resolution:** add the bullet (outcome-unknown, never terminal `failed`, epoch-floor-derived) and the floor's retention rule to 0043's amendment.

4. **MATERIAL — LLP 0133 and LLP 0043 amendments — each declares sole ownership of the same parameters, and neither matches 0162's assignment** (0162 assigns range size/window to the 0043/0012/0095 amendments; 0133's claim over "retention windows" also over-reaches 0162 OQ1; 0163 Open item 2 gives a fourth attribution). **Resolution:** one owner per parameter family; the others reference.

5. **MATERIAL — LLP 0097 amendment — lands three of the four declared scope items; the claim boundary is untouched and under-determined** under the four-axis split (a target could read the boundary as constraining only the isolation axis), and it is still qualified "(while Draft)" in an Accepted RFC. **Resolution:** add the fourth bullet restating the claim boundary across all four axes.

6. **MATERIAL — 0162 §5 (carried into 0164) — the head-reservation quota can defeat the escalation that makes conditional fairness reachable, but is not among the declared conditional-fairness terms** — a fork can exhaust the reservation quota while every declared term holds, making Acceptance 10's fixture unfalsifiable or flaky. **Resolution:** add quota sufficiency to the declared terms (or declare quota exhaustion → `contention-exhausted` as an honest outcome outside the fairness claim); flag the coupling in 0164 Open item 1.

7. **MATERIAL — LLP 0165 and LLP 0164 — the acceptance-row mapping does not close:** 0165 owns the write-authority choke point but claims only rows 11/12 (the choke point's fixtures live in rows 4 and 9, claimed by 0163/0164); and row 13's per-component submetrics are listed only by 0163 — 0164 and 0165 omit them, a silent weakening. **Resolution:** add row 4's completeness leg to 0165 (or name 0163/0164 as its gates) and row 13's submetrics to 0164/0165.

8. **MATERIAL — LLP 0164 and LLP 0165 — §4 is dual-claimed with no cross-Spec precedence rule.** The split is substantively coherent today but stated nowhere, and on divergence 0162 loses to both. **Resolution:** state the §4 split in both Purposes (0164: diff surfaces/folding/substrate; 0165: completeness/digest domains/checkpoints) and add a precedence rule.

9. **MINOR — LLP 0165 — the step-0 baseline coupling is not traceable to 0162** and would change sequencing (step 0 is the performance baseline, not a golden-vector artifact). **Resolution:** decouple.

10. **MINOR — LLP 0164 — drops the admission-ticket identity's epoch governance clause**, the linkage finding 1 turns on. **Resolution:** restore it; cross-reference from 0163's Epochs bullet.

11. **MINOR — LLP 0163 — narrows the epoch-closure issuer condition** ("terminated" vs 0162's "terminated or revoked"); conservative but unannounced. **Resolution:** restore "or revoked".

12. **MINOR — 0162 §0 / OQ5 / OQ14 — protected-lane custody is orphaned by the extraction:** none of the three Specs claims it, but OQ14 claims the extraction settles OQ5's ownership. **Resolution:** assign it to 0163 (the natural home — ctx answers and effect payloads are envelope facts) or note it remains unowned.

13. **MINOR — LLP 0163 Open item 3 reopens `result-expired`, which three same-dated amendments already made normative client contract.** **Resolution:** re-frame as "a later dated revision may collapse it; until then it is normative per the landed amendments".

14. **MINOR — the legacy reverse projection is defined only for (`DenyAll`, `Promotable`);** (`DenyAll`, `NotPromotable`) — the expected intermediate state under sequencing 5(a)→6 — has no stated projection. **Resolution:** state the projection for all (egress, promotion) pairs.

## 4. Suggestions (non-blocking)

- Record the tombstone bound (tombstone growth inside an open client epoch is bounded by the preallocated range size — a nice unstated property).
- Restore 0081's exact "predecessor-derived" wording in 0165's Proof-discipline bullet.
- Enumerate 0097 §5's per-invocation fields (incl. principal/grant, read baseline) in 0164's owned log schema.
- Add the branch/fork receipt to 0164's owned artifacts.
- Spot-checks that passed: `MaterializedBase` writable-copy doc, `branches::promote` post-image path, `ContentDigestHeaderV1` shape, the deviation ticket, and 0158's registry-advisory recovery (confirming 0165's deviation is real and correctly motivated).

## 5. Recommended next step

Do not reopen a full review round — nothing here disturbs the converged architecture, and thirteen of the fourteen findings are editorial-to-seam-level repairs to the extraction and amendment edits rather than to the design. Finding 1 is the exception and should be answered before any implementation work touches promotion identity or the suppression store: it needs a decided host-originator reclamation predicate, which is an author decision (roughly the size of the OQ11 decision), not another cross-family round. Suggested sequencing: (a) author-decide finding 1 and land it as a dated 0162 revision plus a 0163 revision; (b) land findings 2-5 as mechanical repairs in the same commit; (c) land findings 6-8 as dated revisions to 0164 and 0165; (d) sweep findings 9-14 as editorial. Then a single short confirming re-read of the diff — not a new round — is sufficient, since the scoped re-read the round-7 reviewers prescribed has now run and the corpus-rule checks (0043 never-evict, 0097 §5 meaning preservation, 0133 collision, 0158 publication, 0081 inventory) all came back clean.
