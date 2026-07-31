# LLP 0134 review — Fable family


## Round 1 — 2026-07-31

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh non-author subagent
**Effort:** session-inherited
**Date:** 2026-07-31
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree (HEAD `ba752a14` at review start; target SHA-pinned);
mutually blind — no `llp/reviews/` artifact for LLP 0134 read, blind to
this Spec's codex artifact. Verified against: LLP 0113 (full read),
LLP 0130 (full read), LLP 0110 §Local and packaged publication
authority / §Hosted union carrier, LLP 0080 header/Implemented
revision, LLP 0115 CV-8 (v0.5–v0.7) and the open-question-8 decision
registry, LLP 0127 decision-3 context, LLP 0120 finding 9 / OQ5,
LLP 0058 §Capability maturity amendment, the commissioning ticket
`issues/20260731-cv8-piece2-stable-promotion-design.md`, and the two
registries of record in code (`src/manifest.rs`
`TargetCapabilityId::maturity`, `CapabilityMaturity`,
`TargetCapabilityFacts`, the exhaustive registry test, the admission
no-op doc; `packages/snapback-codegen/index.mjs`
`EXPERIMENTAL_TARGET_CAPABILITY_IDS`), plus git history for landing
dates and diaries/demos for the §7 demo-use claims.
**Target:** `llp/0134-capability-maturity-promotion.spec.md` (360 lines)
**Target SHA-256:** `a0ab3f1690a62458930d100c2dc33010f51a0a68f34da8c19289d95314d4ef1e`
**Status:** completed

## Verbatim review

1. **Overall assessment**

LLP 0134 is a disciplined, well-scoped Spec that does what its commission asked and almost nothing it did not. I verified the target hash, read the document end to end, and checked every load-bearing claim against the corpus and the tree. The core fact base is in excellent shape: the seven-id claim is exact in both registries (`src/manifest.rs:5334–5343` and `packages/snapback-codegen/index.mjs:163–171` list precisely `bounded_children_v1`, `inline_handler_v1`, `registered_bundle_boot_v1`, `result_contract_v1`, `versioned_seed_install_v1`, `versioned_seed_reset_v1`, `write_activity_v1`, with `_ => Stable` and no `proposed` id); the named registry test `capability_maturity_promotions_hold_and_admission_stays_fail_closed` exists and pins the same seven; the LLP 0113 §1 quotes are verbatim ("publication CAS changes only the verified runtime-support fact, never the maturity constant"; "promotion to stable requires a later ratified design and evidence; elapsed time or successful demos are insufficient"); §5's no-regeneration claim matches the admission doc word-for-sense (`manifest.rs:6474–6478`: "acknowledging a stable id is a harmless no-op, so acknowledgments survive the capability's later promotion to stable unchanged"); §6's gate-returns consequence matches the same admission logic in the demotion direction; the 0080 precedent dates (0076 Accepted 2026-07-25; 0080/0081 Implemented 2026-07-26, both-registries-one-act) are corroborated by the in-tree registry comment (`manifest.rs:5326–5333`) and 0080's Implemented header; the SD-4 rendering is faithful to LLP 0130 (Review → Accepted only, commissioned documents including "the stable-promotion design" by name, three conditions, escalation on failure) and the ER-2 rendering is accurate; decision 3's wording ("0113's qualification route is the default for new profiles … 0080-style direct-to-stable is reserved for surfaces with witnessed shipped implementations predating the rule") is quoted from the 0115 OQ8 registry correctly, and "mandatory for every id minted after 2026-07-30" is a faithful strengthening — a post-rule id cannot have pre-rule shipped history, so the reserved act is unreachable for it by construction. The commission's five scope items (evidence bar, ratifier, commit mechanics, acknowledgment-gate consequences, demotion/rollback) are all covered; the landing-shape-is-an-author-call caveat is preserved; nothing promotes; A1's cross-registry parity gate is honestly presented as new work (I searched and found no existing cross-language parity check — the Rust exhaustive test pins the Rust side, codegen tests pin the JS side, nothing compares them).

On the five commissioned scrutiny axes: the E1–E8 bar is genuinely falsifiable in seven of eight items; the one-commit act is atomic and mostly auditable because `candidateSourceSha` pins the tree from which E1/E2/E3/E4 are re-verifiable; the demotion asymmetry is consistent with LLP 0005's authority model (a duty to reduce a claim on discovery does not usurp the author's acceptance authority — the author is notified same day, the record is receipted, A5 polices unreceipted flips in both directions, and the claim's return runs the full author-gated bar afresh); the grandfather voiding rule is re-verifiable in its git mechanics but rests on an unadjudicated materiality judgment with a live, unnoted interaction with SD-1; and the closed set's membership claims are right in direction but imprecise in two stated facts. Three concerns are MATERIAL: E6 is the one bar item with no defined witness and no receipt-bound evidence (and §2's preamble overclaims uniformity because of it); §7's stated exclusion ground for the 0110 pair is contradicted by the tree, which contains a passing embedded local publication carrier for exactly that pair since 2026-07-28; and the demotion record lacks the closed-schema treatment the promotion receipt gets, leaving A2/A5 unable to mechanically police the direction the Spec is proudest of. All fixes are local; none changes the architecture.

VERDICT: NOT READY

2. **Strengths**

- **The two-routes-only frame (§1).** Route 1's honest deferral — "Where an id's family kind is not yet in LLP 0113 §4's closed union, adding it is a dated LLP 0113 amendment; this Spec widens nothing by inference" — is exactly right: 0113 §4's union is `relationActivity` / `hostedEphemeral` / `migration`, and the sequence primitive and 3a composite are correctly left to dated amendments (and correctly re-raised as the Spec's own OQ4).
- **Maturity/support orthogonality restated without drift (§1, §4).** "Promotion never makes a support predicate true anywhere" and the receipt-is-not-a-runtime-object paragraph keep 0113's carrier/CAS/supervisor machinery untouched. I found no sentence in 0134 that gives any runtime object authority over the constant, and no sentence that lets the constant masquerade as support — the two §6 negatives 0113 cares most about.
- **The SD-4 boundary section (§3) is the best paragraph in the document.** It states the exact thing a lazy reader would get wrong — that a standing document-acceptance rule might be stretched to cover a claim-increasing code change — and forecloses it with 0130's own honesty framing. The Spec applying SD-4 to itself (§9 last paragraph) while denying it to promotions is internally consistent and matches SD-4's text ("this rule authorizes Review → Accepted only").
- **E5's answer for consumerless capabilities is honest.** "The anonymous-arm gap (LLP 0120 open question 5) narrows the candidate pool and does not waive the item" — promotion waits for a real provenanced arm rather than laundering fixtures into consumers. The exclusion of the acceptance and observation principals closes the two obvious self-dealing paths (0113's `ProvisionalObservationPrincipalV1` could otherwise witness its own consumer).
- **Demotion asymmetry is correctly derived, not asserted (§3, §6).** Claim-increase = author adjudication; claim-reduction = duty on discovery with same-day notification; operational cut stays with support withdrawal; running processes never cut by a static constant; re-promotion never reuses a voided receipt. Each leg checks out against 0113 §4's withdrawal machinery and the admission code.
- **The atomic-pair rule's rationale is stated as a principle** ("their evidence is shared; a split promotion would claim what was never separately witnessed") — the right reason, not just a rule (though see C7 on its scope).
- **A5 closes the loop in both directions**, and its honesty about which violations are mechanically detectable (A1+A2 catch one-sided and malformed; the same-commit rule itself is a norm) is exactly the claims discipline the bar asks for.

3. **Concerns**

**C1. MATERIAL — E6's soak has no defined witness and is the one bar item the receipt cannot re-verify; §2's preamble overclaims uniformity because of it.** E6 requires "at least 14 consecutive days of verified runtime support on at least one ordinary target profile" with four zero-event conditions. Nothing defines what *witnesses* this: what event stream or artifact establishes continuity, at what cadence "verified" is re-established (continuous claim-family renewal on the hosted route is a plausible answer — 0113's final families are ten-minute renewable leases journaled by the supervisor — but the Spec doesn't say it), and above all what it means on the **local** profile, where support is an embedded compiled carrier evaluated at process start in ephemeral contributor-source processes (`TargetCapabilityFacts::local_auth_aware`). Does a local capability soak by the carrier remaining at HEAD with CI green for 14 days? By a daily conformance run? Unstated. The receipt then carries only `soakWindow: { start, end, targetProfileId }` — an assertion, not evidence: every other bar item is digest-bound (`corpusRunDigests`, `claimAuditDigest`, `consumerArmRefs`, `supportEvidenceDigests`, `authorAdjudication`), and E1–E4 are independently re-verifiable from the tree at `candidateSourceSha`, but a verifier of the receipt cannot re-check E6's "zero support-fact regressions," "zero withdrawals," or "zero open MATERIAL defects" from anything the receipt names. Compounding this, §2's preamble claims all eight items are "each witnessed at the exact promotion-candidate source revision and retained in-tree by digest" — which cannot be literally true of E6 (a 14-day window spans revisions; main moves), E7 (lineage receipts predate the candidate revision by construction), or E1 (a review loop's history is not a single-revision witness). **Resolution:** (a) define the soak witness per route — hosted: the supervisor journal's unbroken renewal/withdrawal record for the window, exported or digest-referenced; local: a named cadence (e.g., the E2+E3 rerun plus a dated CI/conformance record at window start, midpoint or better, and end) — and add a `soakEvidenceDigests` (or equivalent) member to the receipt; (b) define the search scope for "zero open MATERIAL defects" (issues/, Linear, the defect-ledger convention) and record the search in the receipt; (c) reword the §2 preamble to claim single-revision witnessing only for the items where it holds (E2, E3, E4, and E3's last-gate negative) and digest-retention for the rest.

**C2. MATERIAL — §7's stated ground for excluding the 0110 pair ("their complete publication receipt has not passed") is contradicted by the tree; the exclusion is right, the stated fact is not.** The tree contains a passing, embedded local publication for exactly this pair: `LocalRelationActivityPublicationV1` compiled via `include_bytes!` with pinned SHA-256 plus the embedded qualification receipt (`tests/conformance/relation-activity-publication-v1.receipt.json`), verified by `local_relation_activity_publication_verified_for` on contributor-source builds, landed 2026-07-28 (`1fbfbef4`, pre-rule) — and the Spec's own named registry test *asserts* the pair is advertised on the local profile ("the reviewed embedded local carrier publishes the atomic relation/activity pair"). So a publication receipt for the pair exists in-tree and passes; what has never run is the **hosted** 0113 §5 chain (plan/confirm/provision/finalize, observation receipt, the LLP 0111 receipt vector). As written, an adversarial reader can argue the pair meets decision 3's letter — "witnessed shipped implementations predating the rule" — via that shipped local carrier, and the Spec's factual rebuttal is wrong on its face. The tree-true grounds for exclusion are available and stronger: (i) the pair fails the Spec's own two-leg membership criterion, because its **demo use** leg is empty — LLP 0120 OQ5 records that `write-with-activity.v1`'s existing-owner-only admission made it "unusable by every anonymous rerun arm," i.e. every demo bypassed it; (ii) the program has already routed the pair through the default path (0115 CV-8 piece 1: "execute the 0113 path — yielding honest experimental maturity"; §8's first-consumer designation), so grandfathering them would contradict a decided work plan. The exclusion direction is fail-closed and safe; this is an honesty/precision defect in the load-bearing membership text of decision 3's registry, not a boundary weakening. **Resolution:** replace "their complete publication receipt has not passed" with the accurate double ground: their hosted 0113 publication has never run and their demo-use leg is empty (0120 OQ5), and they are the default route's designated first consumers per CV-8 piece 1 — noting explicitly that the shipped pre-rule *local* carrier does not confer membership because the membership criterion is acceptance **and** demo use.

**C3. MATERIAL — `MaturityDemotionRecordV1` lacks the closed-schema treatment, so A2 and A5 cannot mechanically police the demotion direction.** §4 gives the promotion receipt a closed canonical-JSON schema, a storage path (`acceptance/results/maturity/`), content addressing, and a validator (A2) that "refuses unknown members." §6 gives the demotion record a parenthetical field sketch — "(the id set, trigger evidence digests, the voided promotion receipt's digest, date)" — with no `schemaVersion`, no canonicalization statement, no storage path, and no validator coverage. Three consequences: (a) if demotion records land in `acceptance/results/maturity/`, A2 as written refuses them (they don't parse "against the closed §4 schema"); if they land elsewhere, nothing validates them; (b) A5's "same-commit conforming receipt … in either direction" is undefined for demotions — conforming to what?; (c) the direction the Spec itself calls a duty-on-discovery, performable by "any maintainer or agent," is exactly the direction that most needs a mechanical shape, because its authors will be acting fast and without the author. **Resolution:** give `MaturityDemotionRecordV1` the same treatment as §4's receipt — closed canonical-JSON schema (schemaVersion, capabilityIds, triggerKind from the closed §6 trigger list, triggerEvidenceDigests, voidedReceiptDigest, notifiedAuthorDate, demotionDate), the same storage root, and extend A2's validator to both document kinds.

**C4. SHOULD-FIX — the promotion commit's relationship to `candidateSourceSha` is unpinned, leaving an unbounded staleness window.** §2 witnesses everything at "the exact promotion-candidate source revision"; §4's commit "carries the promotion and nothing else." Nothing requires the promotion commit's parent to *be* `candidateSourceSha`. On this repo's workflow — multiple concurrent sessions landing to main — an arbitrary number of commits can interleave between the candidate revision and the promotion commit, and every E2/E3/E4 witness then describes a tree that is not the promoted tree's parent. **Resolution:** require the promotion commit's parent to equal `candidateSourceSha`, or explicitly define the tolerated drift (e.g., re-run E4's parity/consistency audit at the actual parent) and record the parent SHA in the receipt.

**C5. SHOULD-FIX — §7's blanket membership fact ("positive predicate held in shipped acceptance and demo use before 2026-07-30") is only partially witnessed; the demo-use leg is unevidenced for `registered_bundle_boot_v1`.** Shipped acceptance checks out for all five (conformance/registration suites in-tree; landing dates 2026-07-27 for the 0108 pair and the seed pair, 2026-07-28 for bundle boot — all pre-rule). Demo use: `result_contract_v1` is acknowledged by four in-tree demos; inline handlers are witnessed in the rerun diaries (0033: "current-main additions were LLP 0108's inline handlers/result contracts"; 0039: "colocated inline handlers … shipped and used"); seed use is diary-attested loosely ("deterministic reset/seed," 0039). For `registered_bundle_boot_v1` I found **no** demo or diary witness — no in-tree demo manifest acknowledges it and no diary names bundle boot. The claim is presented as fact for "each" member. Since the grandfathered act still requires E2–E5 fresh, nothing promotes on this sentence — but it is §7's membership justification and should be either witnessed per member or narrowed. **Resolution:** cite the demo-use witness per member (diary/manifest paths), or weaken to "shipped acceptance before 2026-07-30, with demo use witnessed for N of five (cited); membership for the remainder rests on the acceptance leg" — and if the criterion is genuinely two-legged, say what an unwitnessed demo-use leg means for membership.

**C6. SHOULD-FIX — route 1's local leg names machinery that exists only for the 0110 pair, and the closed-union amendment sentence has no local analog.** §1 route 1 offers "the source-owned `LocalCapabilityPublicationV1` / `PackageCapabilityAttestationV1` carriers (LLP 0110 §Local and packaged publication authority) for local and packaged targets" as generic default-route machinery, and E7 makes the carrier digest the local lineage artifact. But 0110's carrier — in text and in code — binds "the two atomic capability ids" exactly (`carrier.capability_ids == ["bounded_children_v1", "write_activity_v1"]`), and the five grandfather ids' local support facts are plain registered booleans gated by conformance suites, not carriers. So for any current or future local id outside the pair, route 1's local leg has no defined artifact, exactly the way route 1's hosted leg would have no family kind — yet only the hosted gap gets the "adding it is a dated LLP 0113 amendment" escape hatch. This bites OQ3 (a grandfather member waiving its reservation onto the default route today would find no local publication path) and any future local-first id. **Resolution:** add the parallel sentence — where a local id has no source-owned carrier definition, adding one is a dated LLP 0110 amendment (or the generalized carrier is its own small design); this Spec widens nothing by inference.

**C7. DETAIL — the promote-together rule is scoped to 0113 claim families, but its own rationale reaches the seed pair.** §1 mandates joint promotion only for "ids that publish as one atomic claim family" (the 0110 pair). `versioned_seed_install_v1` and `versioned_seed_reset_v1` share one governing LLP and — per the registry comment — one complete mandatory conformance suite enabling both facts: shared evidence, in the Spec's own words the condition under which "a split promotion would claim what was never separately witnessed." Yet the rule as written permits splitting them. **Resolution:** either extend the together-rule to ids whose support evidence is one shared receipt/suite (naming the seed pair), or state explicitly that their suites witness each id severally and splitting is legitimate.

**C8. DETAIL — `acceptance/results/maturity/` mints a new repo-root convention.** No `acceptance/` directory exists; extant receipts live under `tests/acceptance/` (e.g. `auth-mode-predecessor-v1.receipt.json`) and `tests/conformance/` (the relation-activity receipt). A new root is a legitimate choice for document-evidence-not-fixtures, but it should be a stated choice, not an accident the first implementation commit discovers. **Resolution:** one sentence acknowledging the existing receipt locations and why promotion receipts get a separate root (or move the path under the existing convention).

**C9. DETAIL — the voiding rule's "material normative revision" is a judgment with no named adjudicator, and its live interaction with SD-1 goes unnoted.** The git mechanics are re-verifiable (diff the governing LLP from 2026-07-30 to promotion; both 0108 and 0110 already carry 2026-07-30-dated revisions that are explicitly evidence notes — on, not after, the rule date, so the boundary holds, barely). But who classifies a post-rule revision as material, and where is the classification recorded? Presumably the author at E8, in the receipt — say so. And one foreseeable case deserves a sentence: SD-1 (already pre-adjudicated, fires when 0115's A+E slices land) makes omitted result contracts a refusal; if that lands as a normative revision in LLP 0108's family, it plausibly voids `result_contract_v1`'s (and perhaps `inline_handler_v1`'s) reservation, shrinking §7 by operation of a standing decision the Spec never mentions. That outcome may be intended ("the set … can only shrink") — but a Spec that closes a set should note the standing decision already aimed at it. **Resolution:** name the adjudicator and record for materiality (author, at or before E8, recorded in the receipt or the governing LLP addendum); classify dated evidence notes/diary annotations as categorically non-material; add the SD-1 interplay note.

**C10. DETAIL — the SD-6 citation is analogical.** LLP 0130 SD-6 is the scope-migration decision ("no other landing rides the migration commit"); it states no general serialization principle. §4's "(the LLP 0130 SD-6 serialization principle)" borrows the pattern honestly but cites it as if SD-6 governs here. **Resolution:** "(the serialization principle SD-6 instantiates)" or similar.

4. **Suggestions**

- **Record the E1 review-loop evidence in the receipt.** `governingStatusAtPromotion` is re-verifiable from the tree at `candidateSourceSha`, but the dual-family-loop requirement is not a tree fact at one revision; a `reviewJournalRefs` member (paths + digests of the review artifacts) would make E1 as auditable as E2–E4.
- **State the E2 target-profile universe.** "Every target profile whose support predicate is true" quietly depends on the closed profile list (`local-dev-sqlite-ibex`, `remote-service-sqlite-ibex` today); naming the list's owner (codegen's `TARGET_PROFILES` / the manifest schemas) would pin what "every" ranges over when profiles are added.
- **§8 could cite LLP 0110's pair-membership criterion asymmetry.** `bounded_children_v1` has no authority-provenance gap of its own — it is excluded as half of an atomic family whose other half has the gap. One clause would preempt "why can't bounded_children promote alone?" (the §1 atomic rule answers it, but §8 is where a reader will ask).
- **Consider a `promotionCommitSha` self-reference convention** (receipt cited by commit, commit recorded beside the receipt post-landing, e.g. in the governing-LLP addendum) so audits can walk both directions without git archaeology.

5. **Open questions**

- **Can a capability reach registry-global stable on local-dev soak alone?** E6 accepts "at least one ordinary target profile"; the local profile is contributor-source-gated (`build_distribution` check). A stable constant earned entirely on contributor laptops is honest under the orthogonality rule (hosted targets still GAP) — but is that the intended sufficiency? The Spec's own OQ1 half-asks this; it interacts with C1's witness question and deserves resolution together.
- **What is the blast radius of a mistaken demotion?** §6 accepts false-positive demotions as the price of fail-closed (re-promotion runs the full bar; new admissions refuse meanwhile). Probably right — but the Spec never says a mistaken demotion is *tolerable by design*, and a sentence would forestall pressure to add an adjudication gate later.
- **Where does the "zero open MATERIAL defects" search look?** issues/, Linear, and the LLP 0076/0077-style defect ledgers all exist as conventions in this repo; E6 names none (part of C1(b)).
- **Does the guide capability index currently carry rows for all seven experimental ids** (§4 item 6 assumes a row exists to update)? Not verified in this review; the first promotion's E4 audit would catch a missing row, but the Spec could require the row's existence at experimental time.

6. **Verdict**

**NOT READY.** Three MATERIAL concerns — the undefined, receipt-invisible E6 soak witness (C1), the tree-contradicted exclusion ground in §7 (C2), and the unclosed demotion record schema (C3) — each sit on load-bearing text: the evidence bar's only time-extended item, the closed grandfather set's membership basis, and the fail-closed direction's mechanical auditability. All are locally fixable without touching the architecture, which is sound, faithful to the commission (all five scope items, decision 3 honored including the landing-shape caveat, nothing promoted), consistent with LLP 0113's static-constant model and §6 negatives, honest about SD-4's boundary, and boundary-weakening nowhere (the grandfathered waiver is decision 3's reserved act, narrowed — E1–E5 and E8 still bind, stricter than the raw 0080 precedent).

7. **Recommended next step**

Apply C1–C3 and the should-fixes C4–C6 in one revision (define the per-route soak witness and add its receipt member; restate the §7 exclusion on the tree-true double ground; close the demotion record schema and extend A2 to it; pin the promotion commit's parent; witness or narrow the demo-use claim; add the local-carrier amendment sentence), fold the details as one-line edits, then re-review as a targeted delta on §2, §4, §6, §7, and §9. No empirical work gates the revision; A1's parity gate remains correctly sequenced to the first implementation commit.

## Round 2 — 2026-07-31

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh non-author subagent
**Effort:** session-inherited
**Date:** 2026-07-31
**Redacted:** no
**Method:** round-2 delta review — verify each Round-1 Fable concern
against v0.2, re-check the C5 refutation evidence directly in the tree,
then fresh-review the new v0.2 text (demotion fast-path standing
delegation, history-aware A5, per-class E5 lanes, grandfather
manifests/void rule, E6 soak witness). Blind to the codex artifact.
Tree checks this round: `demos/signal-desk/acceptance/results/`
(receipt content + `git log`/`git ls-files`), the five demo
`functions.manifest.json` acknowledgments, the 14 `snapback/seed.json`
demos, `packages/snapback-codegen/index.mjs` `TARGET_PROFILES`,
`src/manifest.rs` seed-pair registry gate (`@ref LLP 0109`), LLP 0130
(full read), LLP 0113 renewal-journal/family-epoch text, LLP 0109
AdminWrite/pre-bind text, LLP 0080 header + acceptance-commit history
(`dc6ae4c2` 2026-07-24, `cff1aff6` 2026-07-26), Diaries 0033/0039
witness lines, `tests/acceptance/` receipt convention.
**Target:** `llp/0134-capability-maturity-promotion.spec.md` (617 lines, v0.2)
**Target SHA-256:** `1e6a214c52b73ab3951da6ae5991f38ad968fb976381c3f483ba2ad8e80a0040`
**Status:** completed

### Round-1 concern resolutions

**C1 (MATERIAL, E6 soak witness) — RESOLVED.** E6 now defines the
witness per route and it is falsifiable on both. Hosted: the supervisor
journal's canonical renewal record as a digest-bound extract with
family-epoch continuity — grounded; LLP 0113 defines the
`capability.publication.renew` verb, requires the journal to "retain
canonical request and response bytes," and defines family epochs, so the
extract is derivable from machinery that exists in the contract.
Local: dated daily green runs of the id's own closed mandatory support
suite at then-current main HEAD, each emitting a receipt binding date,
HEAD SHA, carrier/receipt digests, and outcome; a missing or red UTC
calendar day is a coverage gap and any gap resets the window — genuinely
falsifiable. The population is fixed at window start from the closed
`TARGET_PROFILES` list (verified: `local-dev-sqlite-ibex`,
`remote-service-sqlite-ibex`, `packages/snapback-codegen/index.mjs:175`),
mid-window additions accrue nothing, departures disqualify. The defect
corpus is closed (issues/ open tickets, Linear Exact+Snapback naming the
id or governing LLP, the 0076/0077 ledgers) with the dated search
recorded — C1(b) answered. The §2 preamble now states anchoring honestly
per item (E2/E3/E4a at the candidate SHA; E1/E5/E6/E7 locator-bound) —
C1(c) answered. Residuals are new concerns C11 and C17 below: the daily
observation receipts themselves have no closed schema and collide with
A2's suffix dispatch, and their dates are self-asserted.

**C2 (MATERIAL, 0110-pair exclusion ground) — RESOLVED.** §7 now
concedes exactly what Round 1 found — decision 3's letter arguably
reaches the pair via the shipped pre-rule local carrier — and rebuilds
the exclusion on the tree-true triple ground (hosted §5 chain never run;
demo-use leg empty per LLP 0120 OQ5's "unusable by every anonymous rerun
arm"; CV-8 piece 1 already routes the pair through the default path).
The new framing — decision 3 set an eligibility *ceiling* and this set
is a deliberately stricter subset — is sound: narrowing a reserved act
is claims-tightening, ER-2 constrains only weakening, and the narrowing
is adjudicated by the author's acceptance of this document. "A shipped
pre-rule local carrier alone confers nothing: membership requires both
legs" closes the adversarial reading Round 1 constructed. The
grandfather evidence manifests (`<id>.grandfather.json`, A2-validated,
pre-cutoff commits + witnesses as closed locators +
`governingContractBaselineSha256`) make the pre-rule substitution bound
rather than gestured at, and the tombstone-row rule keeps the printed
table honest. (Baseline-digest definition: see C16.)

**C3 (MATERIAL, demotion record schema) — RESOLVED.**
`MaturityDemotionRecordV1` is now a closed canonical-JSON schema with a
closed three-value `triggerKind` vocabulary, closed evidence locators,
an `authority` member distinguishing `author.v1` from `fast-path.v1`,
and the same records root; A2 dispatches by suffix
(`*.promotion.json` / `*.demotion.json` / `*.grandfather.json`) and
validates all three kinds. The suffix-dispatch construction is clean.
One letter-level mismatch survives between A5 and this schema — C12.

**C4 (SHOULD-FIX, unpinned candidate parent) — RESOLVED.** §4 pins the
promotion commit's sole parent to `candidateSourceSha` with zero
tolerated drift; if main advances, the candidate is re-declared and the
revision-anchored items re-witnessed; the receipt carries
`candidateParentSha` constrained equal, and A5 compares it to the actual
parent so the receipt never names its own commit — a clean answer to the
self-reference problem Round 1's suggestion gestured at. On this repo's
multi-session main the zero-drift rule is strict (a promotion must win a
push race behind a full corpus rerun), but that is an accepted liveness
cost, stated, not a defect.

**C5 (SHOULD-FIX, `registered_bundle_boot_v1` demo use unevidenced) —
REFUTED, and the refutation STANDS on my own verification.** The
evidence is real, in-tree, committed, and pre-cutoff:
`demos/signal-desk/acceptance/results/react-query-group.v1.json` is
tracked (`git ls-files`), clean, landed 2026-07-29 in merge `5f48b969`
("Merge LLP 0102 backend bakeoff"), `generatedAt`
2026-07-29T01:19:55.235Z, and contains the check
`generated-registered-bundle-boot` with `ok: true` plus
`adoption.source`/`adoption.bootSource` = `"registered-bundle"`,
`providerCustody: true`, 3/3 passed — a real demo app
(`backend-bakeoff`, profile `local-dev-sqlite-ibex`) booting from the
registered bundle. My Round-1 search looked only for manifest
acknowledgments and diary mentions; this id's demo adoption is
receipt-witnessed, which v0.2 §7 now states precisely ("a
receipt-witnessed demo adoption path rather than a manifest
acknowledgment"). I withdraw the C5 claim of no witness. v0.2 also now
cites witnesses per member as C5 asked. Two residual precision notes:
the `result_contract_v1` manifest count is five, not four (C14), and the
seed-pair leg (seed.json presence + Diary 0039's reset/seed row)
witnesses seeding use, not specifically the versioned v2 carriers —
tolerable because the grandfathered act still requires E2–E5 fresh, so
nothing promotes on that sentence.

**C6 (SHOULD-FIX, local carrier escape hatch) — RESOLVED.** §1 route 1
now states the local leg symmetrically: LLP 0110's carrier binds the two
atomic ids exactly and generalizes to nothing else; where a local or
packaged id has no carrier definition, adding one is a dated amendment
to LLP 0110 or the governing LLP (or a small owned carrier design),
"never an inference from this Spec." Exactly the parallel sentence
Round 1 asked for, with the honest extra detail that the other
experimental ids' local facts are plain registered booleans.

**C7 (DETAIL, seed pair and the together-rule) — RESOLVED.** "The rule
follows the evidence, not only the wire carrier": the seed pair is
joined to promote-and-demote-together on the shared-suite ground, which
I verified in the tree — the registry gate comment at
`src/manifest.rs:5640` (`@ref LLP 0109`) advertises both ids only after
the closed executable suite passes every mandatory local row. The
solo-route escape (a dated revision recording every §2 item witnessed
severally) is the right shape.

**C8 (DETAIL, records root) — RESOLVED.** `tests/acceptance/maturity/`
sits inside the existing `tests/acceptance/` receipts convention
(verified: `auth-mode-predecessor-v1.receipt.json` lives there), and §4
item 4 states the choice explicitly, naming the conformance-receipts
location too.

**C9 (DETAIL, materiality adjudicator + SD-1 interplay) — RESOLVED.**
The adjudicator is named (the author, at or before E8, recorded in the
receipt or governing-LLP addendum), dated evidence notes and diary
annotations are categorically non-material (with the two 2026-07-30
notes cited as the worked example), and the SD-1 interplay is now
explicit: SD-1 may void `result_contract_v1`'s — possibly
`inline_handler_v1`'s — reservation, and that shrinkage is declared
intended.

**C10 (DETAIL, SD-6 citation) — RESOLVED.** Now "the serialization
principle LLP 0130 SD-6 instantiates for its own scope migration" —
the exact reframing requested.

Round-1 suggestions: E1 `reviewJournalRefs` added; the E2 profile
universe is pinned to codegen's `TARGET_PROFILES`; the
promotion-commit self-reference is solved via A5's parent comparison
(better than the suggested convention). The §8 bounded-children clause
was not added — suggestion only, §1's atomic rule answers it.

### New v0.2 text

**The demotion fast-path standing delegation (§3, §6) — the
construction is sound under LLP 0005/0130.** The chain of authority is
intact: LLP 0130 is the author's own pre-adjudication ("the rules below
are therefore the author's own decisions, made in advance"), SD-4 names
"the stable-promotion design" among the commissioned documents it may
accept, and this Spec's fast path takes effect only on that acceptance —
so the delegation is activated by an author-authorized act, not minted
by the document unilaterally, and the Spec says so in both places rather
than smuggling it. ER-2 does not fire: the fast path operates only in
the claim-reducing direction (stable → experimental), its two triggers
are objective and closed (a red committed gate at HEAD on a population
profile; A2 cryptographic invalidity), subjective triggers always
escalate, and every use is recorded as a standing-rule act — LLP 0130's
honesty framing applied in both directions. The asymmetry with §3's own
"delegating routine promotions would be an explicit dated LLP 0130
amendment" is principled (claim-increase vs claim-reduction), not
inconsistent. Residual registry-completeness gap: C13.

**History-aware A5 — sound for promotions.** Transition-commit
identification, sole-parent equality against the receipt's
`candidateParentSha`, one transition per range, diff-derived id set,
same-diff completeness requirement, and final-tree tests on the
transition commit itself all check out and make Round 1's
"norm-not-mechanism" worry obsolete. The demotion leg has a letter-level
defect — C12.

**Per-class E5 lanes — grounded.** The seed pair's operator-lane
framing matches LLP 0109 ("`install` uses the same `AdminWrite` or
pre-bind startup authority", line 872; §3.1.1 closed pre-bind startup
carrier). Class assignment is implicit (each id's governing LLP declares
its production authority lane) but determinable; the
principal-exclusion rule carries over intact. No concern.

**E4 split into candidate + promotion-tree audits — sound**, resolving
what "stale" means on each side of the flip. One locator-level
self-reference nit: C15.

### New concerns

**C11. MATERIAL — E6's local daily observation receipts have no closed
schema and collide with A2's suffix dispatch.** E6-local requires each
daily run to emit "a dated receipt binding date, HEAD SHA,
carrier/receipt digests, and outcome, retained under §4's records
root" — i.e. under `tests/acceptance/maturity/`. But A2 "parses every
file under `tests/acceptance/maturity/` against the closed schema its
suffix names — `*.promotion.json` (§4), `*.demotion.json` (§6),
`*.grandfather.json` (§7)": the daily receipts match none of the three,
so a conforming A2 either refuses them (making E6-local unexecutable as
specified) or silently skips them (voiding A2's every-file guarantee) —
the Spec does not say which, and both readings contradict something.
Compounding: `soakEvidence.observationRefs` are closed evidence
locators whose `schemaVersion` must name "the referenced artifact's own
closed schema," and no closed schema for the daily receipt exists —
only a four-item prose field sketch, the exact defect class C3 was
MATERIAL for on the demotion record. By Round 1's own severity
standard this is MATERIAL, and it sits on the load-bearing fix: the
local lane is the operative soak witness for the first promotion (§8's
0110 pair is supported today only on `local-dev-sqlite-ibex`).
**Resolution (small):** define a closed
`MaturitySoakObservationV1` (schemaVersion, capabilityIds, dateUtc,
headSha, suiteProducer, carrierDigests, outcome) with its own suffix
(e.g. `*.soak-observation.json`), add it to A2's dispatch, and name it
as the `observationRefs` schemaVersion.

**C12. SHOULD-FIX — A5's parent check names a member the demotion
record does not have.** A5 requires the transition commit's sole parent
"to equal the record's `candidateParentSha` (= `candidateSourceSha`,
§4)" and applies "in either direction"; §6's `MaturityDemotionRecordV1`
schema has no `candidateParentSha` (rightly — a demotion has no
candidate revision), so a conforming demotion mechanically fails A5's
letter, or A5 is unimplementable for demotions. §6's "the demotion
commit mirrors §4 — sole-parent pin" never says what the pin equals.
**Resolution:** specify A5's demotion leg as sole non-merge parent +
exactly one transition per range + same-diff record completeness,
without the candidate-equality clause (or add a `demotionParentSha`
member and pin it the same way).

**C13. DETAIL — the fast-path delegation is invisible to the standing-
decision registry and has no revocation/lapse semantics.** LLP 0130 is
where standing decisions live, with author revocation-by-dated-revision
and auto-lapse when the served plan dies; the §6 fast path will exist
outside it, unlisted, with neither property stated. **Resolution:** on
acceptance, add a dated 0130 revision row pointing at LLP 0134 §6, and
one sentence here: the author may revoke the fast path by dated
revision, and it lapses if this Spec is Superseded or Withdrawn.

**C14. DETAIL — §7's "four demo generated manifests" is five.**
`all-aboard` also acknowledges `result_contract_v1`
(`demos/all-aboard/snapback/generated/functions.manifest.json`,
`acknowledgedExperimentalCapabilities: ["result_contract_v1"]`, landed
2026-07-27 — pre-cutoff). An undercount inherited from my own Round-1
text; evidence-safe in direction, but §7 presents the count as a
witnessed membership fact, so it should be right. **Resolution:** "five
demo generated manifests (todo, todo-v2, rbac, competitive-checkpoint,
all-aboard)."

**C15. DETAIL — the promotion-tree audit's locator `sourceSha` is
self-referential.** E4(b) is produced from the promotion commit's own
tree, and its locator lives in the receipt committed *in* that commit;
`sourceSha` ("the revision that produced the artifact") would be the
promotion commit's SHA, which cannot be known when the receipt is
written — the same self-reference §4 explicitly engineered
`candidateParentSha` to avoid. **Resolution:** define E4(b)'s
`sourceSha` as `candidateSourceSha` with the promotion-tree audit
understood to run on the staged tree (A5's final-tree run on the
transition commit is the post-hoc verification), or allow a designated
`"promotion-tree"` sentinel.

**C16. DETAIL — `governingContractBaselineSha256` is not yet
computable.** "The canonical digest of the governing LLP's normative
text as of 2026-07-30" defines neither the extraction ("normative
text" — whole file? minus evidence notes?) nor the intra-day pin (both
LLP 0108 and 0110 carry 2026-07-30-dated revisions; which commit is the
baseline?). Since the very next sentences make evidence notes
categorically non-material at *adjudication* time, the digest should
simply be the whole-file canonical bytes at a named commit.
**Resolution:** bind the baseline as a full locator (path, sha256,
sourceSha = a named cutoff commit) in the grandfather manifest, and
drop "normative text" from the digest definition (materiality, not the
digest, filters evidence notes).

**C17. DETAIL — daily soak receipt dates are self-asserted.** A
14-day local window could be back-fabricated by running the suite at 14
historical HEADs after the fact; the receipts would verify, but no run
happened on the claimed days — and a mid-day red state repaired before
an evening backfill run would evade the reset rule. Git commit history
is the natural corroborator. **Resolution:** require each daily
observation receipt to be committed on its stated UTC day (A2 or the
soak verifier may check receipt date against commit date), or state the
trust model explicitly.

### Verdict

**NOT READY** — but converged to a narrow mechanical delta. All three
Round-1 MATERIALs (C1–C3) are resolved, all should-fixes and details
(C4, C6–C10) are resolved, and the C5 refutation stands on my own
verification of the signal-desk receipt. The new standing-delegation
construction, history-aware A5, and per-class E5 lanes are sound. One
new MATERIAL remains — C11, the unclosed soak-observation schema
colliding with A2's suffix dispatch, the same defect class that made C3
MATERIAL, sitting on the local route the first promotion will use —
plus one should-fix (C12, A5's demotion-leg letter) and five one-line
details (C13–C17). No architectural issue anywhere; nothing promotes.

### Recommended next step

Apply C11 and C12 (one closed observation schema + A2 dispatch entry;
one A5 demotion-leg sentence), fold C13–C17 as one-liners, and
re-review as a very narrow delta on §2 E6, §4's locator rule, §6/§9
A2+A5, and §7's witness counts. That delta is hours, not days, from
READY on this family's bar.

## Round 3 — 2026-07-31

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh non-author subagent
**Effort:** session-inherited
**Date:** 2026-07-31
**Redacted:** no
**Method:** round-3 delta review — verify each Round-2 Fable item
(C11–C17) against v0.3, then verify the Codex-originated v0.3 changes
did not damage text this family verified clean: the staged-tree
anchoring (unique-child derivation + post-hoc addendum) and the
restated §7 0110 demo-use ground. Blind to the codex artifact. Tree
checks this round: the five demo `functions.manifest.json`
acknowledgment lists (each exactly `["result_contract_v1"]`),
`demos/signal-desk/snapback/functions.mjs` (declaration census + the
two adapter-bypass comments), consumer sweep for
`incidentTasks`/`incidentComments`/`incidentActivity` across
`demos/signal-desk` (hits: comparator config, `tests/snapback-extras.mjs`,
generated `artifacts.json`, the defining file — no product code),
Diary 0033 line 57 ("kept the board view and atomic move as ordinary
inline JS"), Diary 0039 line 33 (colocated-inline-handlers row), the
signal-desk `react-query-group.v1.json` receipt and its retained
evidence copies, the 14 `snapback/seed.json` demos, both maturity
registries (still exactly seven experimental ids), and LLP 0113 §4.2
(lines 555–575 contain both the `capability.publication.renew` verb
row and "the supervisor journal must retain canonical request and
response bytes").
**Target:** `llp/0134-capability-maturity-promotion.spec.md` (727 lines, v0.3)
**Target SHA-256:** `5867e4a87b5371286a8f99aec54fbbb0af7bfbebe24c59d5fd47c71523e07a43`
**Status:** completed

### Round-2 item resolutions

**C11 (MATERIAL, soak-observation schema / A2 collision) — RESOLVED.**
E6's *Evidence records* subsection defines all three evidence classes
as closed canonical-JSON documents with stated member lists and their
own suffixes — `MaturitySoakObservationV1` (`*.soak-observation.json`),
`MaturitySoakJournalExtractV1` (`*.soak-extract.json`),
`MaturityDefectSearchV1` (`*.defect-search.json`) — and A2's dispatch
now names all six suffixes and refuses a file matching no suffix, so
the silent-skip/refuse dilemma is gone. The locator `schemaVersion`
tokens are named exactly (`soak-observation.v1`, `soak-extract.v1`,
`defect-search.v1`), closing the `observationRefs` dangling reference.
This is my proposed resolution, member-for-member.

**C12 (SHOULD-FIX, A5's demotion parent check) — RESOLVED.**
`MaturityDemotionRecordV1` gains `candidateSourceSha` ("the revision
the trigger evidence is witnessed at"; on the fast path, the HEAD
where the gate ran red or validation failed) and `candidateParentSha`
constrained equal to it and to the demotion commit's sole parent; A5
now reads "§4's receipt for promotions, §6's record for demotions."
The parent comparison is provable in both directions.

**C13 (DETAIL, fast-path registry visibility) — RESOLVED.** §6: on
acceptance a dated LLP 0130 revision row records the fast path as a
standing decision hosted at this §6; the author may revoke by dated
revision of either document; automatic lapse on Superseded or
Withdrawn. All three requested properties.

**C14 (DETAIL, manifest count) — RESOLVED and re-verified.** "Five
demo generated manifests (todo, todo-v2, rbac, competitive-checkpoint,
all-aboard)"; I re-checked all five in-tree and each acknowledges
exactly `result_contract_v1`.

**C15 (DETAIL, promotion-tree audit self-reference) — RESOLVED.**
E4(b)'s locator `sourceSha` is defined as `candidateSourceSha` under
§4's staged-tree rule, the artifact anchored by `candidateParentSha`
plus its own `sha256`, with A5's final-tree run on the transition
commit as the post-hoc witness — the exact shape my resolution asked
for. Soundness assessment under "Codex-originated changes" below.

**C16 (DETAIL, baseline digest computability) — RESOLVED.**
`governingContractBaseline` is a full closed locator; the digest is
the whole-file committed blob bytes at a named baseline commit; the
intra-day pin is decidable ("the last main-history commit with
committer UTC date on or before 2026-07-30 that touched that file");
"there is no extraction or normalization step — 'normative text' is
not a digest concept; materiality adjudication … not the digest,
filters evidence notes." Exactly the requested binding. (One residual
fillability nit on the locator's other members — C20.)

**C17 (DETAIL, self-asserted soak dates) — RESOLVED.** An observation
is credited only when its introducing commit's committer UTC date
equals its `dateUtc`, A2 refuses the mismatch, and the
back-fabrication rationale is stated. My proposed corroborator,
adopted as specified.

### Codex-originated v0.3 changes, verified against this family's clean text

**Staged-tree anchoring — SOUND.** The self-reference is genuinely
broken: no file the promotion commit carries names the promotion
commit's SHA; the receipt anchors on `candidateParentSha` plus content
digests; the commit SHA is recovered post hoc and recorded as a dated
follow-up line in the governing-LLP addendum — a separate
documentation commit that changes no registry, so A5 correctly does
not fire on it. The general locator definition ("`sourceSha` is the
revision that produced the artifact") is explicitly carved for this
one class rather than silently contradicted, and §2's anchoring
preamble was updated to match. A5's transition-commit identification
remains the mechanical authority; the derivation predicate is a
documentation convenience. One precision nit on "unique" — C19.

**The restated §7 demo-use ground — VERIFIED, with one count error.**
The three `defineBoundedChildrenQuery` declarations exist as named
(`incidentTasks`, `incidentComments`, `incidentActivity`,
`demos/signal-desk/snapback/functions.mjs` lines 69/96/116); a full
sweep of `demos/signal-desk` finds their only consumers are the
comparator config, the acceptance-harness extras, and the generated
artifacts — no product code — so "no joint real production consumer
outside the acceptance corpus and comparator fixtures" is tree-true.
The adapter-bypass claim is confirmed by the in-file comments ("the
bakeoff's dev-impersonation transport intentionally keeps using the
explicit handler"). The honest concession that decision 3's letter
arguably reaches the pair, the eligibility-ceiling framing, and the
"a shipped pre-rule local carrier alone confers nothing" closure all
survive intact from v0.2. But "the demo's **sole**
`defineWriteWithActivity` declaration" is false — C18.

### New concerns

**C18. DETAIL — Signal Desk has two `defineWriteWithActivity`
declarations, not a "sole" one.** `addTaskWithActivity` (line 244, the
review-gated proving declaration §7 describes) and
`toggleTaskWithActivity` (line 306, "Acceptance-only closed profile …
The product adapter keeps its backend-neutral toggle contract"). Both
are deliberately bypassed by the product adapter, so the exclusion
ground is strengthened, not weakened — but §7 presents the count as a
witnessed tree fact and it is wrong, the same defect class as C14.
**Resolution:** "its two `defineWriteWithActivity` declarations are a
review-gated proving declaration and an acceptance-only profile, both
deliberately bypassed by its product adapter."

**C19. DETAIL — "the unique child of `candidateParentSha` whose tree
holds the receipt" is not a git-graph invariant.** Uniqueness holds on
the landed history (A5 admits exactly one transition per pushed range)
but the graph may contain other children of the same parent — an
abandoned pre-race promotion attempt on a side ref would carry a
receipt at the same path. The recovered SHA is a documentation line,
so the exposure is small. **Resolution:** one clause scoping the
derivation to main's landed history, or equivalently "the transition
commit A5 identifies."

**C20. DETAIL — the `governingContractBaseline` locator's
`schemaVersion` and `producer` members are unfillable for LLP prose.**
§4's closed locator requires `schemaVersion` to "name the referenced
artifact's own closed schema" and `producer` to name the emitting
suite or tool; a governing LLP file has neither, and only prose
diaries get a named token (`diary.v1`). A conforming grandfather
manifest cannot be written until the tokens exist. **Resolution:** name
them once in §4 or §7 (e.g. `schemaVersion: "llp-prose.v1"`,
`producer: "git"` for committed-blob evidence).

### Verdict

**READY.** Every Round-2 item is resolved as requested — C11's three
closed schemas with A2 suffix lanes and no-suffix refusal, C12's
demotion-side parent pin making A5 provable in both directions, and
C13–C17 each landed in the exact proposed shape — and the two
Codex-originated v0.3 changes I audited are sound: the staged-tree
anchoring breaks the receipt/commit self-reference cleanly, and the
restated 0110 exclusion ground is tree-true in every checked
particular except one word. Three DETAILs remain (C18's "sole" is a
false stated tree fact, direction-safe; C19's uniqueness scoping;
C20's locator tokens), none MATERIAL, none touching the bar, the
routes, the authority model, or the fail-closed posture. Nothing
promotes.

### Recommended next step

Fold C18–C20 as three one-line edits — C18 first, since the author
should not accept a document containing a known false tree fact, even
a harmless one — in the acceptance revision or a v0.4. No further
Fable-family round is needed unless the other family's round 3 forces
non-trivial new text.
