# LLP 0134 capability maturity promotion review — Codex family


## Round 1 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** fresh CLI runner, read-only sandbox, blind to this Spec's fable artifact
**Target SHA-256:** `a0ab3f1690a62458930d100c2dc33010f51a0a68f34da8c19289d95314d4ef1e`
**Status:** completed

## Verbatim review

**Reviewer family:** Codex / GPT  
**Provider / runtime:** Codex  
**Date:** 2026-07-31  
**Redacted:** no  
**Method:** commissioned in-session review

## Overall assessment

LLP 0134 has the right architecture and preserves the most important existing boundaries:

- LLP 0113’s static, code-owned maturity constant remains authoritative.
- Publication CAS changes support only, never maturity.
- Promotion does not widen support predicates.
- The acknowledgment-gate consequences match current admission behavior.
- The SD-4 boundary is explicit and substantively airtight: LLP 0130 SD-4 authorizes this Spec’s Review → Accepted transition only, not capability promotion.
- The tree contains exactly the seven experimental IDs claimed, identically in [the Rust registry](/Users/ccheever/projects/snapback/src/manifest.rs:5325) and [the codegen mirror](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:163).
- The five grandfather candidates have pre-cutoff implementation and consumer evidence. LLP 0080’s paired-registry promotion precedent is represented accurately.

However, the Spec is not yet falsifiable or mechanically enforceable at the requested bar. Several acceptance claims exceed what the proposed receipt and CI machinery can prove.

## Strengths

- The separation of maturity from runtime support is unusually clear and faithful to LLP 0113.
- E1–E8 form a strong conceptual evidence ladder: accepted contract, complete corpus, adversarial negatives, claim audit, real consumer, soak, support lineage, and author ratification.
- Retaining the final acknowledgment-refusal witness is excellent practice.
- The one-commit goal correctly prevents transient registry disagreement.
- Existing artifacts’ stable acknowledgments being harmless no-ops matches current code and the LLP 0080 precedent.
- Demotion correctly distinguishes operational support withdrawal from correction of the static maturity claim.
- The grandfather set is closed by name and excludes all future IDs, avoiding an inference-based loophole.
- `bounded_children_v1` and `write_activity_v1` are correctly kept on the stricter default route as a policy choice; this weakens no evidence boundary.

## Concerns

### 1. MATERIAL — A1+A2 cannot prove the claimed same-commit atomicity

[A5 claims](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:318) that registry parity plus receipt validation mechanically detects an unreceipted flip “in either direction.” It does not.

A state-only check can prove:

- the two current registries agree; and
- some valid receipt exists.

It cannot prove that the receipt, registry flips, tests, LLP addendum, and guide updates entered in the same commit. An old receipt could coexist with a later flip. The receipt also cannot contain the promotion commit SHA without a self-reference problem.

Resolution:

- Add `candidateParentSha` to the receipt.
- Define a history-aware CI check that examines exactly `parent..HEAD`, requires a single promotion-only commit, derives the changed ID set from the diff, and requires the matching new receipt/addendum/guide changes in that diff.
- Run final-tree tests on the promotion commit, not only candidate-parent tests.
- State how merge commits and stacked promotions are refused.

### 2. MATERIAL — The receipt is insufficient for independent re-verification

The receipt schema records mostly bare digests. It lacks locatable, typed references for E1 and much of E2–E8:

- no review-artifact or author-acceptance references for E1;
- no paths, producer/schema identities, or case counts for corpus digests;
- no concrete audit-receipt reference;
- no soak observations;
- no defect-registry snapshot;
- an underspecified `{date, record}` author adjudication;
- no closed demotion schema.

A digest without an object locator and schema cannot generally be reopened or interpreted.

Resolution: use closed evidence references such as `{path, sha256, schemaVersion, producer, sourceSha}` throughout, including explicit E1 acceptance/implementation receipts, author-ratification provenance, and soak evidence. Define `MaturityDemotionRecordV1` as rigorously as the promotion receipt and give promotion and demotion files distinguishable schemas or locations.

### 3. MATERIAL — E6 is not falsifiable

[E6](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:115) does not specify:

- what observes support;
- how often it observes it;
- whether missing observations reset the window;
- which target instances comprise “any supporting target”;
- how changing target population is handled;
- where withdrawals and regressions are recorded;
- which issue corpus determines “zero open MATERIAL defects.”

A start/end/profile tuple cannot prove 14 consecutive days of support.

Resolution: define a closed soak receipt with an enumerated target-instance or release/profile scope, required observation cadence, maximum observation gap, exact support predicate and claim head/carrier digest per observation, withdrawal/demotion event sources, and a defect-registry snapshot. Missing coverage should reset the window. “Any supporting target” must refer to a finite enumerated set.

### 4. MATERIAL — E5 excludes legitimate non-ordinary capability consumers

[E5](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:107) universally requires an ordinary generated surface and ordinary principal. That is incompatible with grandfather members such as versioned seed install/reset, whose intended consumers operate through pre-bind/AdminWrite and explicit destructive-reset authority, not an ordinary application principal.

It also leaves future internal or operator-facing capabilities with no valid consumer even when their public contract intentionally has no external application arm.

Resolution: require a real non-fixture consumer through the capability’s governing production authority lane. For application capabilities, require an ordinary principal; for administrative/startup capabilities, require the exact ordinary operator/startup authority. Continue excluding acceptance, qualification, and observation principals.

### 5. MATERIAL — Demotion authority is not grounded in LLP 0005

Immediate support withdrawal by any maintainer is sound. But [allowing any maintainer or agent to land maturity demotion](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:225) also changes both static registries and adds a normative governing-LLP addendum based on subjective “MATERIAL” judgments.

LLP 0005 does not establish a general rule that claim reduction permits agents to revise accepted designs unilaterally. Honesty requires immediate operational withholding; it does not itself supply document-change authority.

Resolution: either:

- require author adjudication for maturity demotion while allowing immediate support withdrawal; or
- add an explicit author-standing demotion delegation with objective triggers and escalation for disputed materiality.

Receipt cryptographic invalidity could be an objective automatic trigger; behavioral divergence usually is not.

### 6. MATERIAL — Grandfather eligibility and voiding need decidable records

The five named IDs do have pre-2026-07-30 evidence: their local positive facts were already true in the July 29 tree; Signal Desk retained seed and registered-bundle consumer receipts; inline handlers and result contracts had earlier bakeoff/demo use.

But the broad factual predicate also describes the LLP 0110 pair: both IDs had positive local support and Signal Desk use before the cutoff. Their exclusion is still defensible—and safer—because the complete publication program was unfinished, but it is an intentional narrowing of the eligible population, not something implied solely by “witnessed shipped implementation.”

The voiding rule—“material normative revision after 2026-07-30”—is also subjective and has no baseline digest or persistent void record.

Resolution:

- Add a grandfather evidence manifest binding each member to exact pre-cutoff commits, consumer receipts, positive-predicate evidence, and governing-contract baseline digest.
- Explicitly say the decision provided an eligibility ceiling and this Spec deliberately selects a stricter subset, explaining the LLP 0110 exclusion.
- Define a decidable void rule, ideally based on changes to a canonical normative-contract digest, and record every void as a dated tombstone so the apparent table cannot silently disagree with effective membership.

### 7. MATERIAL — A1’s cross-language comparison mechanism is unspecified

The Rust authority is an executable function over `TargetCapabilityId::ALL`; the JavaScript mirror is a private set. A robust CI equality check cannot safely scrape either source as prose.

Resolution: specify one implementable bridge, for example:

- a Rust command/test emits the sorted non-stable registry as canonical JSON;
- codegen exports its sorted experimental set to the test-only checker; and
- CI compares the two outputs.

Longer-term, generating both from one canonical registry source would remove the mirror hazard entirely.

### 8. MATERIAL — E4 contradicts the candidate and compatibility model

E4 requires that “no stale experimental reference survives” at the candidate revision. At that revision the ID is still experimental, so experimental references and acknowledgments are current and required. Section 5 also deliberately permits already-generated acknowledgments to survive promotion indefinitely.

Resolution: split this into:

- candidate audit: every experimental reference is current and consistent; and
- promotion-tree audit: authoritative registry/guide statements are updated, while historical generated acknowledgments remain explicitly permitted.

### 9. MINOR — E1’s explanation is historically inaccurate

The statement that an ID is experimental “precisely because” its contract is not Accepted is too narrow. LLP 0080 remained experimental after acceptance until its Implemented witnesses landed. E1 itself correctly requires both Accepted and Implemented.

Resolution: say experimental persists until the governing contract is accepted, implemented, and explicitly promoted under the applicable route.

## Suggestions

- Define `MATERIAL` or point to one authoritative severity vocabulary.
- Bind all timestamps to UTC RFC 3339 and define inclusive/exclusive soak endpoints.
- Clarify whether atomic claim-family coupling is permanent maturity coupling or specific only to the LLP 0110 pair.
- Require the receipt validator to reject duplicate/conflicting receipts for the same transition.
- State that promotion CI tests the post-flip admission behavior as well as retaining the pre-flip refusal witness.
- Give future local/package capabilities an explicit authority-owner requirement; LLP 0110’s carriers are pair-specific and cannot be generalized implicitly.

## Open questions

1. Is the soak population a finite release/profile set, named target instances, or every deployment known to a registry?
2. What exact evidence counts as the author’s own promotion adjudication?
3. Should objective receipt corruption permit automatic maturity demotion while behavioral regressions require author adjudication?
4. Is every claim family necessarily one maturity unit, or can IDs sharing support publication mature independently?
5. Does any governing-contract change void grandfathering, or only a change to a defined canonical normative digest?

## Verdict

**NOT READY**

The SD-4 boundary itself passes scrutiny, and the core maturity/support separation is correct. The blockers are mechanical falsifiability, receipt sufficiency, demotion authority, consumer generality, and decidable grandfather/CI rules. These are unresolved MATERIAL concerns, so LLP 0130 SD-4 cannot fire.

Recommended next step: revise §§2, 4, 6, 7, and 9 around a history-aware transition validator and closed evidence-reference schemas, then request Codex re-review before counting this family READY.

I did not read any `llp/reviews/0134-*.fable.md` file. The required Codex review artifact could not be written because the workspace is read-only.

## Round 2 — 2026-07-31

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (`medium` per CLI banner)
**Date:** 2026-07-31
**Method:** round-2 delta — verify each Round 1 concern (8 MATERIAL + 1 MINOR) against v0.2, then review new text only; fresh CLI runner, read-only sandbox, blind to this Spec's fable artifact; Round 1 section above provided as required context
**Target SHA-256:** `1e6a214c52b73ab3951da6ae5991f38ad968fb976381c3f483ba2ad8e80a0040`
**Session id:** `019fb74c-0b26-7670-8b7b-e98c13e74a4f`
**Status:** completed

### Verbatim review

Verified target SHA-256: `1e6a214c52b73ab3951da6ae5991f38ad968fb976381c3f483ba2ad8e80a0040`. I read only the required Codex Round 1 section and did not read `llp/reviews/0134-capability-maturity-promotion.fable.md`.

## Round 1 resolution register

1. **A5 atomicity — PARTIALLY RESOLVED, MATERIAL remains.**  
   Promotion is now mechanically grounded: `candidateParentSha == candidateSourceSha`, sole-parent validation, transition-commit diff inspection, refusal of merges/stacking, and final-tree testing are all specified ([§4](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:280), [A5](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:565)).  
   However, A5 covers transitions “in either direction,” while `MaturityDemotionRecordV1` contains neither `candidateSourceSha` nor `candidateParentSha` ([§6](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:402)). A5 therefore cannot perform its required parent comparison for demotions.

2. **Evidence locators, demotion schema, suffix A2 — MOSTLY RESOLVED.**  
   The five-field locator is present, E1–E8 use typed locators, demotion has a closed schema, and A2 dispatches promotion/demotion/grandfather suffixes ([§4](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:290), [A2](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:552)).  
   Residual: `voidedReceiptDigest` is still a bare digest despite §4 stating that a digest without a locator cannot be reopened or interpreted. This is MINOR independently, while the missing demotion parent fields are MATERIAL under concern 1.

3. **E6 per-route witness — RESOLVED conceptually.**  
   Hosted journal continuity, local daily green runs, finite recorded population, population-loss/gap reset, exact window endpoints, full rerun, and a closed defect corpus make the soak claim falsifiable ([E6](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:175)).

4. **Per-class E5 lanes — RESOLVED.**  
   Application and operator/startup capabilities now use their actual production authority lanes, while acceptance, qualification, and observation principals remain excluded ([E5](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:159)).

5. **Demotion authority — RESOLVED.**  
   Immediate support withdrawal is separated from maturity mutation; subjective demotions require author adjudication; the fast path is a standing delegation proposed by this Spec, effective only upon acceptance, and limited to committed-gate failure or cryptographic invalidity ([§6](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:363)). This is compatible with LLP 0005 and the SD-4 boundary.

6. **Grandfather decidability and 0110 exclusion — NOT FULLY RESOLVED, MATERIAL.**  
   Per-member manifests, baseline digest, author-recorded materiality decisions, tombstones, and the eligibility-ceiling framing are now present ([§7](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:494)). Two problems remain:

   - “Canonical normative text” has no extraction or canonicalization algorithm, so `governingContractBaselineSha256` cannot be independently reproduced.
   - The claimed tree-true ground that the LLP 0110 pair’s “demo-use leg is empty” and “every rerun arm bypassed the pair” is false as written. Signal Desk contains real `defineBoundedChildrenQuery` declarations ([functions.mjs](/Users/ccheever/projects/snapback/demos/signal-desk/snapback/functions.mjs:69)), and the retained review says the demo executes the unadvertised profiles. The write-with-activity declarations are proving/acceptance-only and the product adapter bypasses them ([functions.mjs](/Users/ccheever/projects/snapback/demos/signal-desk/snapback/functions.mjs:241)). The defensible statement is that the atomic pair lacks a joint real production consumer—especially a provenanced write arm—not that both capabilities have no demo use.

7. **Canonical-JSON A1 — RESOLVED.**  
   Both sides emit sorted canonical JSON and CI compares bytes, avoiding source scraping ([A1](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:541)).

8. **E4 two-tree split — RESOLVED semantically, but introduces a fresh MATERIAL defect.**  
   Candidate experimental references and promotion-tree authoritative statements are now correctly distinguished ([E4](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:146)). See new concern N1 below.

9. **E1 history — RESOLVED.**  
   The text now accurately says LLP 0080 remained experimental after acceptance until Implemented witnesses landed and explicit promotion occurred ([E1](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:125)).

## New delta concerns

### N1 — MATERIAL: promotion-tree audit creates a commit-SHA self-reference

E4 requires an audit receipt “on the promotion commit itself,” and the promotion receipt must reference it through a locator containing `sourceSha`. Both are required in the promotion commit. Consequently, the receipt must contain the SHA of the commit whose SHA depends on the receipt’s bytes—the same self-reference §4 correctly avoided for the promotion receipt itself.

Define a non-self-referential mechanism, such as an A5-resolved transition sentinel, or make the history-aware transition check itself the promotion-tree witness under explicitly different locator semantics.

### N2 — MATERIAL: E6 evidence files have no A2 suffix/schema lane

Local daily receipts must be retained under §4’s maturity records root ([E6](/Users/ccheever/projects/snapback/llp/0134-capability-maturity-promotion.spec.md:192)), but A2 says every file there is parsed using only the three promotion/demotion/grandfather suffixes. Daily observations, hosted journal extracts, and defect-search records have no dispatched suffix/schema.

Either retain referenced evidence outside `tests/acceptance/maturity/`, or extend A2 with closed suffixes for every evidence-artifact class.

### N3 — MINOR: bare voided-receipt digest

Change `voidedReceiptDigest` to a closed locator, or explicitly specify unique digest lookup over the maturity-record corpus.

## Verdict

**NOT READY**

SD-4 cannot fire: unresolved MATERIAL concerns remain, including non-provable demotion atomicity, the inaccurate LLP 0110 exclusion rationale, undefined grandfather baseline canonicalization, and the new promotion-tree self-reference.

Next step: revise §§4, 6, 7, and A2/A5 to close those points, then request a targeted Codex round 3. The workspace is read-only, so I could not append this Round 2 review to the Codex artifact.
