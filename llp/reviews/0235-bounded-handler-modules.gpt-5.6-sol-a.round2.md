# Round 2 delta review: LLPs 0235–0241

## Provenance

- Reviewer: Codex GPT-5.6-sol xhigh, reviewer A
- Review mode: author-directed single-family adaptation of `llp-super-refine`; fresh isolated delta review
- Round: 2
- Lens: architecture, correctness, security, ownership, and cross-RFC coherence
- Capsule: `/tmp/snapback-llp-super-refine-r2-min.2KGrDu`
- Capsule SHA-256 (reviewer instructions excluded): `235147b6fdbc5963734808c3fce9c35886d032e0603efe3377fb6b9646135507`
- Isolation: reviewed only the supplied capsule; did not inspect sibling review artifacts or the live workspace other than creating this assigned artifact
- Target hashes verified before review:
  - LLP 0235: `2d3118645c67aec72f7b8d2b560789d73bbeacaaf7dcca85f612f15f31025ab6`
  - LLP 0236: `14ab7278154814b715fea8b78e1897789b158187db6c54221aa722453cb58247`
  - LLP 0237: `ef0e8553807c7e90d6f4ab078273527602d91127df20bd8dc84c8478fd381d11`
  - LLP 0238: `06658688843b51c2a34e824e7dbd9bcb85c870002ed86fca0b735afdd28d875b`
  - LLP 0239: `9f28cbaed244cdaf8d16ed448fc656e6055b5f512b67c724a0797c03b6375dfe`
  - LLP 0240: `0f79e2cfb522541ace43b54103c637d9862fc3f8c431f6b1550671bc9481d3e1`
  - LLP 0241: `78d23b0a9b6244c94f6e44e013017ec718e8211550fcd525b3081cdbd9f0dffc`

No MATERIAL `PRE-EXISTING` concern remains in this review. Two MATERIAL `IN-DELTA` concerns require repair and another delta review.

## LLP 0235: Bounded handler modules

### Summary

The revision closes the important semantic holes in the bounded-module proposal. Refusing module and named re-export cycles avoids transform-dependent ESM ordering, emitted `.js`/`.mjs` custody keeps TypeScript transforms out of v1, and the normalized root-relative edge/topology rule now aligns with LLP 0239. Admission remains Snapback-owned and fail-closed; bundling is not treated as the security boundary.

### MATERIAL

None.

### MINOR

- D4 uses the singular phrase “implementation identity” for a list that includes both canonical semantic inputs and final executable bytes, while LLP 0239 deliberately separates `semanticId` from `executableId`. The surrounding text makes the intended split recoverable, but the implementation Spec should name the per-operation semantic and executable hashes explicitly so a toolchain-only byte change cannot accidentally enter semantic identity.
- The profile-selection rule is coherent across the first flagged release and later automatic `required-by-import` selection. The generated selection reason should also record the capability-flag/compatibility epoch while the staged migration is active; this is ordinary manifest detail, not an RFC blocker.

### Author questions

1. Is “implementation identity” in D4 intended to mean the executable operation identity only, with the canonical graph/contract inputs separately feeding the semantic operation identity under LLP 0239?

VERDICT: READY

## LLP 0236: Explicit client lifecycles

### Summary

The selected public vocabulary is substantially clearer: `read`, `watch`, truthful `dispatch`, durable `mutation(id)` observation, `run`, `start`, and explicit presence/auth projections. The microtask-first subscription rule and in-place, coalesced `WatchHandle.refresh()` give the handle protocol implementable ordering and ownership. Omitting a canonical `useSnapbackRead` is a sound v1 boundary because no cache lifetime is otherwise defined.

### MATERIAL

1. **IN-DELTA — `mutation(id)` claims durable states that contradict LLP 0218’s authoritative settlement/collection contract.**

   **Evidence:** D2 says the handle observes “LLP 0218’s complete mutation-disposition union,” but then requires an unknown id, predecessor-authority id, collected result, and acknowledged record to be distinct typed states. LLP 0218’s supplied contract instead defines `pending | settled | failed | stranded | quarantined | resultGone | unknown`, explicitly says `unknown` covers “never enqueued here, or ACK-consumed and collected” because no durable record remains, and keeps observation non-consuming with `markMutationSettlementsConsumed()` as the sole consumption cut. D2 simultaneously scopes lookup to the current app, store, user, and authority instance while promising a distinct predecessor-authority state.

   **Consequence:** The declared API cannot be implemented from the governing durable facts without either retaining new tombstones after LLP 0218’s sole consumption/collection cut or searching a predecessor authority partition. The first silently changes GC, retention, and settlement ownership; the second weakens partition/non-enumeration boundaries. It can also invite callers to infer settlement from an acknowledged/collected state where LLP 0218 deliberately says `unknown` licenses no such inference.

   **Repair:** Choose one authority. The narrow repair is to expose LLP 0218’s exact additive-open union, preserve `resultGone`, and leave ACK-consumed/collected or inaccessible predecessor-partition ids as `unknown`/the existing scoped refusal with no settlement inference. If distinct acknowledged, collected, or predecessor-authority states are product requirements, explicitly amend LLP 0218/0043 and freeze the durable tombstone schema, retention bound, sole writer/collector, authority-partition lookup rule, non-enumeration behavior, and optimistic-layer mapping before claiming the states here.

### MINOR

- The common `TaskHandle` grammar omits `retry()`, while `start(CommandRef)` is described as supporting retry and LLP 0237 projects LLP 0180’s successor-task retry through this handle. Extra lifecycle-specific methods are not forbidden, so this is not material, but the canonical type should show a command-task extension or state explicitly that `TaskHandle` is only the common minimum.
- Disposal generation-fences predecessor callbacks, while `subscribe()` promises exactly one queued initial microtask. The Spec should pin that dispose-before-delivery cancels/suppresses the callback rather than invoking a listener after disposal.

### Author questions

1. Is the intent to preserve LLP 0218’s existing `unknown` after ACK/collection, or to reopen settlement retention with a new bounded tombstone?
2. Should generated command tasks expose `retry()` as `RetryableTaskHandle`, leaving the displayed `TaskHandle` as the common base?

VERDICT: NOT READY

## LLP 0237: Asset collections and the media field

### Summary

The revision establishes a credible single commit owner. `MediaCommandBindingV1` is closed metadata rather than an arbitrary mapping callback; the ordinary mutation host validates and executes the handler once, then stages collection/reference/grant effects in the same transaction. Command-only dispatch closes the attachment-skipping path. Stable never-reused collection item identity and LLP 0180’s ambiguity, cancellation, and successor-retry semantics are now explicit.

### MATERIAL

None.

### MINOR

- State the emitted public type for `defineMediaCommand` as an explicit extension/intersection that preserves LLP 0180’s `retry()` and residue/cleanup inspection in addition to LLP 0236’s `TaskHandle` grammar. The semantics are already present; only the cross-RFC type projection is implicit.
- The phrase “resolves the declared parent path” should be paired in the implementation Spec with the exact admissible result-contract path grammar and nominal parent-id check. D3 already requires exact result validation and commit-time parent reauthorization, so this is not an ownership gap.

### Author questions

1. Will the generated media-command task retain LLP 0180’s complete command-specific surface, including synchronous successor `retry()`, rather than narrowing structurally to the base `TaskHandle` shown in LLP 0236?

VERDICT: READY

## LLP 0238: Application authority profiles

### Summary

The facade is now correctly subordinate to existing authorities: it lowers to the exact LLP 0056 membership declaration and LLP 0231 policy IR, uses the central writer-class seam as the enforcement boundary, and permits no co-active roster authority. The real protected owner role, atomic transfer, deletion witness, and eligible-last-holder rules close the most consequential ownership ambiguity. Strict custom input completeness supports precise invalidation; otherwise the online-only coarse-global lane is honest and fail-closed.

### MATERIAL

None.

### MINOR

- The generated signatures shown for `invite` and `changeRole` are schematic. Generated types/docs should distinguish active, pending, bootstrap/protected-owner, and transition-admitted role subsets so callers do not discover only at runtime that `owner` cannot be set by an ordinary role change.
- “Every relevant application/authorization change” in the coarse-global custom lane should become a concrete target capability/event class in the implementation Spec. The RFC already refuses targets unable to provide that conservative wake, so the safety posture is sound.

### Author questions

None.

VERDICT: READY

## LLP 0239: Semantic artifact generations

### Summary

The unique `generationId` resolves same-semantic-cut aliasing, and normalized module edges now match LLP 0235. Making the per-consumer disposition map authoritative, with the maximum only a display reduction, is the correct way to retain incomparable prerequisites. The two-generation/64-MiB/60-second retirement envelope is usefully bounded, but its failure transition is internally contradictory.

### MATERIAL

1. **IN-DELTA — drain failure has two incompatible admission outcomes, leaving the stale/security boundary undefined.**

   **Evidence:** D5 first says that when owners or bytes cannot drain within the limits, automatic activation is abandoned, “current resumes admissions,” and the candidate becomes `restart-required`. Two paragraphs later it says, “If reload cannot occur safely, the consumer stops accepting new work” and “does not continue indefinitely stale.” The same section gives every non-evidence generation a `staleAfterMs`, including zero for security-critical changes, but does not say when that deadline starts or whether it applies when the candidate never becomes current and the predecessor has resumed.

   **Consequence:** Two conforming-looking custodians can make opposite choices after the same failed drain. One may run predecessor semantics indefinitely after an authority/security change; another may unnecessarily halt a still-authoritative predecessor for a candidate that never activated. The ambiguity also prevents the server/pointer activation conjunction from proving that no custodian crossed into a mixed or stale cut.

   **Repair:** Freeze a single state machine that distinguishes at least: (a) candidate not activated and pointer still on predecessor; (b) successor current elsewhere while this custodian is draining/stale; and (c) security-critical zero-deadline replacement. Specify whether all blocking custodian drains/restarts are activation prerequisites, the exact linearization point that starts `staleAfterMs`, and the admission rule in each state. A safe narrow rule is: predecessor may resume only while it remains the authoritative current generation and no zero-deadline obligation requires quiescence; once a successor is current or a deadline expires, the stale custodian refuses new work; a security-critical candidate either quiesces required custodians before pointer movement or cannot activate until controlled restart readiness is positive.

### MINOR

- The implementation Spec needs a visibly non-recursive hash construction for `bundleId`, `integrity.json`, `generation.json`, and `generationId`. As written, `bundleId` includes integrity manifests while the envelope manifests list the identities. This is implementable if the inner payload manifest excludes/zeros outer identity fields, but that exclusion should be normative rather than inferred.
- D4’s evidence-only pointer update is coherent with an unchanged semantic/readiness nonce, but inspection should expose both “active semantic runtime cut” and “current evidence/publication cut” so operators do not mistake a new `generationId` for runtime rollover.

### Author questions

1. After a 60-second drain failure, is the predecessor allowed to resume only until a candidate deadline, or indefinitely because the candidate never activated?
2. Are first-party custodian drain/restart dispositions prerequisites to pointer movement, or may the pointer move and rely on immediate stale refusal afterward?

VERDICT: NOT READY

## LLP 0240: Bounded query composition

### Summary

The revision makes the four-node algebra materially safer. Composite completeness is bound to one authoritative snapshot; aggregates are exact-or-sealed and limited to noninterfering indexed populations; activity avoids unproved post-merge enrichment; and feed now uses a genuine exact top-k frontier with bounded work, per-scope continuation witnesses, and a portable minimum capability.

### MATERIAL

None.

### MINOR

- D5 says all reads, “including rows rejected by composed visibility,” count toward `maxExamined`, then correctly requires that authorization-hidden rows cannot affect success, refusal, or frontier shape and refuses residual post-range visibility. The latter rule is the controlling safe rule, but the former phrase suggests an impossible/leaky execution. Clarify that in an admitted v1 protected range no authorization-hidden row enters the charged frontier population; otherwise a hidden-row-dependent work-limit refusal would be an oracle.
- Children pagination intentionally re-evaluates all child windows at a new common snapshot while reusing old cursors only as positions. The result is exact at the new snapshot but not a stable historical traversal; generated guide text should say so plainly alongside the feed cursor’s contrasting same-snapshot continuation.

### Author questions

1. Is “rows rejected by composed visibility” intended to describe only non-sensitive/public predicates after authority partitioning? If so, rename it to avoid contradicting the noninterference admission rule.

VERDICT: READY

## LLP 0241: Policy-aware protected retention

### Summary

The revision correctly extends the existing LLP 0053/0043 query-instance lease/store owner rather than creating a cache coordinator. Eligibility is narrow—generated plans, exact result/completeness, proven policy, and exclusion provenance. Never-reused query-instance identity, collision-checked canonical arguments, bounded deterministic eviction, logical-backup omission, and server-only MAC verification all align with the governing accepted threat model. The RFC also explicitly avoids depending on automatic generation reload.

### MATERIAL

None.

### MINOR

- D2 correctly preserves retained compatibility across an evidence-only `generationId` rotation, while Acceptance says unqualified “generation rotation” quarantines/deletes before read. Qualify the Acceptance item as an incompatible semantic/executable/retention generation rotation; otherwise it contradicts the selected per-consumer evidence-only disposition and causes needless data loss.
- D5’s “opaque encrypted/controlled record” should not be read as an encryption-at-rest claim. The governing LLP 0053 threat model explicitly says the lease is not hostile-client protection. The implementation/capability text should identify which carriers are merely access-controlled and which, if any, supply device encryption.

### Author questions

1. Should the Acceptance matrix preserve an evidence-only successor without purge exactly as D2 requires, while still rotating stored producing-generation provenance?

VERDICT: READY

## Set-level consistency

The set has a strong overall decomposition:

- LLP 0235 and LLP 0239 now agree that normalized module targets and graph topology are semantic/executable inputs, while comments, spans, maps, and `@ref` prose are evidence.
- LLP 0237 and LLP 0238 can activate independently, and both explicitly generation-refuse authority-profile media sharing until both exact capabilities qualify. There is no profile↔media activation cycle.
- LLP 0240 exposes retained eligibility as a separate fact, and LLP 0241 consumes only a generated exact projection with its own lease/store proof. Neither query portability nor authority-profile existence silently grants protected retention.
- LLP 0241 explicitly does not depend on automatic LLP 0239 reload and retains the legacy exact `activation_hash` lane during dual emission.

The two MATERIAL `IN-DELTA` concerns above prevent set convergence: LLP 0236 currently creates a second, unspecified durable settlement-history contract, and LLP 0239 does not define one safe retirement/admission result after failed drain.

Set-level MINOR points:

- The claimed rollout order is only partially normative in the documents. LLP 0239 clearly puts identity audit/dual emission first, and 0237/0238 clearly gate their composition. LLP 0241 keeps its capability false during descriptor scaffolding and is independently safe, but it does not explicitly say “protected retention activates last” relative to the whole set. If that is an author-mandated release invariant rather than orchestration preference, add one cross-set rollout paragraph/capability prerequisite; do not rely on this review capsule to preserve it.
- LLP 0236’s base `TaskHandle` and LLP 0237’s LLP 0180 command task should share an explicit type-extension relation so retry/ambiguity behavior cannot disappear in one generated arm.
- The evidence-only compatibility wording should be normalized across LLP 0235’s `sourceEvidenceHash`, LLP 0239’s `evidenceId`, and LLP 0241’s descriptor compatibility terminology. The semantics align; the names could still invite duplicate hashes.

### Set author questions

1. Is “protected retention activates last” a hard capability dependency to encode in manifests, or a release-program ordering choice?
2. Should the next revision use one generated identity vocabulary table mapping operation-level hashes, application `semanticId`/`executableId`/`evidenceId`, and retained descriptor hashes?

SET VERDICT: NOT READY
