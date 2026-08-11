# LLP 0232 — gpt family review

## Round 1 — 2026-08-11

**Reviewer family:** gpt
**Provider / runtime:** fresh `codex exec` session, model gpt-5.6-sol,
reasoning effort xhigh, read-only sandbox, cwd = review capsule; launched by
the super-refine orchestrator (Claude Fable 5 session)
**Date:** 2026-08-11
**Round:** 1
**Redacted:** no
**Method:** capsule-scoped codex session (structural exclusion of
`llp/reviews/0232*` from the capsule); blindness additionally self-attested
in the reviewer's first line
**Capsule:** sha256
`007f8c59e750c9d3e1df5c2d83950468a1e5ba9768a308d454381d81970520c6`
(repo HEAD `0fb17c721099015bcc37b893152e1d816166d2b1` + target rev1 +
EVIDENCE-DOSSIER.md + REVIEW-INSTRUCTIONS.md)
**Bound to revision:** rev1 sha256
`403c9b189ad6f9002a64d315bf9a3519e1e3cb04fc9ab97408fb5463fff0f323`
**Round instructions:** identical for both families; include the author's
empirical rider (weigh every design element against the evidence dossier;
redesign feedback invited)

Body below is verbatim (codex --output-last-message capture).

---

Blindness attestation: I did not read any `llp/reviews/0232-*` file, super-refine run journal, or orchestrator note; I worked only from this capsule.

Method: I read LLP 0232 in full, LLP 0189, CLAUDE.md, LLP 0041’s publication posture and current release record, LLP 0175’s cadence and drift-gate registry sections, EVIDENCE-DOSSIER.md, and the canonical `local-proof` workflow where needed to check trigger and authority claims. I evaluated D-1 through D-7 against the dossier’s ranked costs, then checked composition, consistency with LLP 0189, and whether the proposed automation has enough attribution and authority to act safely.

## MATERIAL findings

1. **The central intervention does not attack the dominant cost and may amplify it.**

   Git branches already give each session a stable snapshot; changing that snapshot from recent HEAD to an hours-old `green` does not remove reconciliation. D-3 still requires every lander to rebase onto current `main`, run affected checks, and race the push. Starting farther behind can enlarge the integration delta and increase conflicts in exactly the generated files that cause the treadmill.

   The dossier is unusually decisive here: classified gate blocks outnumber visible true races 177 to 26; a plain race costs roughly 1–2 minutes; the measured bad cycle cost 69 minutes because it added regeneration and re-verification; the open livelock ticket measures a roughly 10-minute gate against an 8-minute landing interval; and about 14% of recent commits are integration/regeneration churn. D-6 acknowledges this but makes the only strongly evidenced work a non-blocking audit whose option (c) permits accepting the cost unchanged.

   This is a decision-quality defect, not an implementation detail. Before adopting mandatory green-based branching, the RFC needs to make content-keyed gate receipts, prepared-runtime reuse, rebase-stable generated records, and gate-infrastructure repair the primary, acceptance-blocking intervention. It should then measure whether green-based branch cuts reduce enough triage to offset their larger landing delta.

2. **D-2’s attribution guarantee is false under the observed failure model.**

   “Every failure observed on a branch cut from `green` is attributable to the branch” does not follow from one complete battery pass. The dossier records 128 raw infrastructure-failure messages in which the pre-push gate could not reach a staleness conclusion, plus toolchain-dependent false drift and real environment failures. A previously passing content snapshot can also later encounter flaky, service, runner, or dependency failures. After D-3 rebases the work onto current, possibly-red `main`, the green-base guarantee no longer applies at all.

   This matters because the RFC uses clean attribution to justify eliminating triage and empowering automated repair. Incorrectly classifying infrastructure or post-rebase base failures as branch defects can create unnecessary fixes or reverts. The model needs typed evidence such as `BRANCH_REGRESSION`, `KNOWN_BASE_RED`, `INFRASTRUCTURE`, and `NONDETERMINISTIC`, with comparison to the exact green receipt where attribution is required. D-2 should promise removal of known-content base ambiguity, not universal attribution.

3. **The complete battery does not supply the causal attribution D-4 needs for default reverts.**

   LLP 0175 explicitly defines the complete proof as a repository-wide integration verdict, “not a per-commit attribution claim.” At the observed cadence, a 12-hour green interval can contain roughly 70–110 commits. A failing gate at R therefore does not identify which commit to revert; an integration failure may also result from the interaction of multiple individually valid commits.

   D-4 jumps directly from “pin R and its failure set” to choosing revert or fix-forward without specifying a causal range, bisect strategy, use of affected-proof receipts, dependency analysis, or a safe revert candidate. This is especially unsafe in the dossier’s environment: a recovery rebase nearly incorporated unintended reverts, a rebase silently dropped an author ruling, and churn itself repeatedly generated new drift. Later commits may depend on the suspected change, making a textual revert neither cheap nor semantics-preserving.

   The sheriff needs a bounded attribution protocol and explicit revert eligibility. At minimum, an automated revert should require an identified causal commit, a self-contained inverse, no dependent landed work, green affected checks over the resulting tree, and defined handling for multi-commit or interaction failures. Without those conditions, fix-forward or escalation—not revert—must be the default.

4. **The sheriff policy conflicts with governing repair, claim, and publication rules.**

   D-4 activates after 12 hours and defaults to revert, while the documented 24-hour convention gives the landing author first ownership and then converts the work to fix-forward-by-anyone. LLP 0189 D-1 likewise establishes fix-forward tickets and author escalation after four scheduled reds. LLP 0232 acknowledges the conflict as an open question, but this is the core authority rule, not a detail that can remain unresolved at acceptance.

   The “reverts are nearly free” rationale also overreads LLP 0041. “No current users depend on stability” supports frequent qualified publication; it does not make source reversals free. The expected users are agents consuming published packages and documentation, npm versions are immutable, and `latest` is advanced rapidly. Reverting claim-relevant source is itself a scoped-surface change under LLP 0189 D-3, requiring demotion or a requalification-pending marker. D-4 files only a fix-forward ticket and says nothing about standing claims, guide fences, or a version already published from the reverted source.

   The RFC must rule on owner priority, the 12-hour/24-hour conflict, severity exceptions, claim-state updates, and published-closure handling. It should amend the governing decisions explicitly rather than claim the red-handling model is unchanged.

5. **The automation lacks the authority, serialization, and durable-state contract needed to be safe.**

   D-1 requires write access to advance a protected repository ref, but the existing complete-proof workflow has `contents: read` and removes checkout credentials. D-4 additionally requires an agent with authority to change `main`, trigger proof runs, and possibly revert other authors’ commits. Thus this is materially more than adding a retag step.

   The RFC does not identify the credential holder, ref protection, validation of the proof artifact and tested SHA, singleton/lease behavior for sheriff runs, compare-and-swap semantics, handling of an on-demand run against a non-main ref, or recovery from partial ref/ledger updates. D-1 asserts that the pointer never moves backward without specifying the ancestry and atomicity check that enforces it. The proposed ledger is alternately described as a file and as an uncommitted battery artifact, with no retention or integrity authority. The ref representation and on-demand battery authority remain open questions even though D-1 and D-4 depend on them.

   Acceptance needs a concrete control plane: authenticated proof-result consumer; ancestry-checked, forward-only CAS update; durable append-only receipt storage; protected writer identities; a singleton sheriff lease; idempotent repair records; and explicit escalation when automation cannot act safely.

## Minor findings

1. **Cadence wording is inconsistent.** Twelve hours is described as “one missed battery cycle plus slack,” while the current canonical cadence is six hours. A trigger based on completed outcomes—such as two consecutive eligible reds—is clearer than elapsed time, which also fires when infrastructure failed to run.

2. **D-3’s verification ordering is ambiguous.** It first says affected checks run after rebasing, then singles out semantic conflicts as the case where the lander “re-runs” them. The RFC should state which checks may be reused by content receipt and which must run after each kind of integration change.

3. **The ledger description is internally unsettled.** D-1 specifies an append-only ledger file; Open Question 4 proposes an uncommitted artifact. Choose one authority and define retention, uniqueness, and reconciliation with timestamp tags.

4. **The portability claim is premature.** D-7’s “exactly four primitives” omits causal attribution, central write authority, serialization, durable receipts, dependency-aware rollback, and claim/publication coordination. No cross-repository evidence is provided. Portability should be assessed after a Snapback pilot.

5. **The proposed worktree-bootstrap benefit is unevidenced.** The dossier found only five real dyld events and no observed submodule wedge; bootstrap is now a paved routine. Keeping old green snapshots compatible with prepared artifacts should not count materially in the case for adoption.

6. **There are no success or rollback criteria.** A pilot should measure green age, branch-to-land latency, generated-file conflicts, gate reruns avoided, broken-base triage time, sheriff interventions, false attributions, revert fallout, and published/claim disruptions.

## Evidence-fit assessment

| Element | Evidence fit | Assessment |
|---|---|---|
| D-1 `green` ref | Partial | Thirty-one sessions encountered broken-base discovery, including abandoned work, so a machine-readable last-green SHA is justified. The dossier does not establish that a moving Git tag plus separate ledger is preferable to a signed CI health artifact, nor that green-pointer stalling is itself a dominant cost. |
| D-2 branch from `green` | Mixed to negative | It reduces known-red ambiguity during pre-rebase development. It does not eliminate infrastructure ambiguity or post-rebase ambiguity, and an older base can increase the generated-file integration delta responsible for the dominant cost. Mandatory adoption is not justified without a pilot. |
| D-3 unchanged optimistic landing | Coherent with LLP 0189, poor fit to the dossier | Preserving prompt affected-only landing is correct. But D-3 also preserves the exact race/regenerate/re-gate loop causing 10–70 minute cycles, so it cannot support the RFC’s claimed landing-cost reduction. |
| D-4 sheriff/default revert | Weak and unsafe as written | Twenty-five red-main tickets support having clear repair ownership. The evidence does not show default revert is cheap or that lack of a sheriff is the dominant bottleneck. The battery lacks per-commit attribution, while high churn, dependent commits, and rapid publication make broad reverts risky. |
| D-5 claims unchanged | Correct principle, incomplete composition | Declaring `green` non-evidentiary is correct and consistent with LLP 0189. However, sheriff repairs and reverts can alter claim-scoped source and published/main correspondence, so the procedure must execute LLP 0189’s demotion/requalification rules rather than merely disclaiming a claim effect. |
| D-6 regeneration audit | Strongest evidence fit, materially underweighted | This directly targets the dossier’s dominant problem, but an optional audit is too weak. The design should require content-keyed reusable receipts, exact input closures, prepared-runtime reuse, post-land regeneration where honest, and repair of gate infrastructure failures. |
| D-7 portability | Unevidenced | The dossier is Snapback-specific and exposes additional required primitives absent from D-7. Portability adds speculative scope without solving an observed cost. |

Against the dossier’s snag ranking:

- **Landing regeneration and re-verification:** largely ignored by D-1–D-5 and potentially worsened by stale branch bases; D-6 points in the right direction but is non-blocking.
- **Drift-gate infrastructure fragility:** ignored. A green source base does not repair a gate environment that cannot produce a verdict.
- **True push races:** preserved. They are frequent but cheap when no content-coupled work is invalidated; automation or receipt reuse is more proportionate than branch-model redesign.
- **Broken-base triage:** partially reduced before integration, but not after rebasing onto current main and not for infrastructure/nondeterministic failures.
- **Wait/poll and long verification:** unchanged; repeated waits remain whenever a retry invalidates proof work.
- **Fresh-checkout/worktree wedges:** not materially improved, and the dossier says they are no longer a major bottleneck.
- **Signal saturation, churn-begets-churn, environment variance, and calendar-shaped records:** ignored; default automated reverts risk adding more churn.

## Redesign suggestions

1. Recenter the RFC on a **content-keyed landing proof**. Cache each successful selected-gate result against the gate implementation/version and its declared semantic input closure. After a disjoint upstream rebase, reuse the receipt; rerun only gates whose inputs changed. Reuse the existing digest-bound runtime-readiness receipt in heavyweight gates.

2. Repair the gate substrate before changing branch discipline: eliminate infrastructure-induced push blocks, make environment/toolchain inputs explicit, and measure gate cold-start versus prepared-state latency. Add an automatic fetch/rebase/push retry for the cheap race case.

3. Publish a machine-readable **main health record** containing the last complete-green SHA, tested battery run, current red signatures, attribution window, open tickets, and infrastructure/indeterminate states. Use the green SHA initially for diagnosis and optional task-specific branch cuts, not as a mandatory global base.

4. Pilot green-based cuts only for work whose affected subsystem is currently known red on main. Compare their total branch-to-land cost with recent-HEAD branches before making D-2 universal.

5. Replace the default-revert sheriff with an event-driven **repair coordinator**. Trigger it from a completed red battery, preserve the author’s ownership window, use per-push receipts and bounded bisection for attribution, and fix forward by default. Permit automated revert only for a proven, dependency-safe, unclaimed/unpublished causal unit; otherwise escalate.

6. Give the coordinator a protected service identity, singleton lease, idempotent run record, forward-only ref CAS, and explicit claim/publication hooks. Treat a published or claim-scoped change as non-revertible without the corresponding demotion/requalification and release plan.

VERDICT: NOT READY
---

## Round 2 — 2026-08-11

**Reviewer family:** gpt
**Provider / runtime:** fresh `codex exec` session, model gpt-5.6-sol,
reasoning effort xhigh, read-only sandbox, cwd = round-2 review capsule;
launched by the super-refine orchestrator. NOT the rev2 reviser session.
**Date:** 2026-08-11
**Round:** 2 (full round; rev2 is a full rewrite, so no IN-DELTA/PRE-EXISTING
classification was requested)
**Redacted:** no
**Method:** capsule-scoped codex session (structural exclusion of
`llp/reviews/0232*`); blindness additionally self-attested in the first line;
round-1 reviews unavailable to the reviewer
**Capsule:** sha256
`760c2268e39aa2a7dc9a050007893181c220df23c970cf580c193662f5d63cad`
(same pinned repo snapshot as round 1, HEAD `0fb17c721`, target replaced by
rev2, round-2 instructions)
**Bound to revision:** rev2 sha256
`2dac73939ffcaf4c1356c76600afcc7c51e58d64fa510dec8ae8e0e313dd4222`

Body below is verbatim (codex --output-last-message capture).

---

Blindness attestation: I did not read any `llp/reviews/0232-*` file, super-refine journal, orchestrator note, or round-1 review.

Method: I reviewed revision 2 standalone against `EVIDENCE-DOSSIER.md`, LLPs 0189, 0175, and 0041, the livelock ticket, `CLAUDE.md`, and the actual selector, registry, runner, and gate fixtures. I treated the document’s review dispositions only as unverified author claims.

## MATERIAL findings

1. **D-1’s reuse condition makes the intended common case unreachable and contradicts its exact-tree claim.**

   The current policy declares `module-ownership` in `driftAlwaysRunGates`; direct selector evaluation confirms that every changed path, including `README.md` and LLP prose, selects it. Therefore every intervening upstream commit selects at least one gate in every receipt. D-1’s requirement that intervening commits “select none of those gates” prevents whole-battery receipt reuse after any real race—the exact scenario the mechanism exists to solve. The success criterion that “every eligible disjoint retry” reuses its receipt can consequently pass vacuously by classifying no retry as eligible.

   Separately, a receipt for the pre-rebase revision can bind the tested tree, or it can transfer a gate-scoped result to a different post-rebase tree, but it cannot itself “cover exactly the pushed tree.” The latter requires a new validation/reuse decision bound to the new tree.

   Resolve this with per-gate receipts keyed to verified semantic input closures. Bind the original remote base and selector calculation, recompute selection against the new base, validate each gate independently by closure equality, and emit a derived reuse receipt binding the new pushed tree to the prior execution. Always-run status alone must not invalidate reuse when the gate’s semantic closure is byte-identical. Historical fixtures must demonstrate non-vacuous reuse against representative real traffic, including docs/LLP commits racing a heavyweight core landing.

2. **D-3’s fail-open classification is not safe or coherent with the accepted gate contract.**

   LLP 0175 explicitly says infrastructure ambiguity blocks. The current runner implements that rule: infrastructure returns status 2 and stops the push. D-3 reverses this to unconditional non-blocking `INFRASTRUCTURE` and `NONDETERMINISTIC`, but neither declares the normative amendment to LLP 0175 nor supplies the classification safety contract needed to make the reversal honest.

   Today, infrastructure is inferred from setup failures, exit statuses 126/127, and a bounded output regex; there is no `NONDETERMINISTIC` state. The RFC does not say who may assert these types, how nondeterminism is proven, how unknown failures are handled, or how false infrastructure attribution is tested. Its acceptance criteria optimize only for “zero push blocks,” creating an incentive to widen the non-blocking bucket without measuring content failures misclassified into it.

   The ticket precondition is also not operationally closed. Current inherited-red pushes may proceed without an open ticket, and drift tickets are keyed by gate, not root-failure signature. A local pre-push hook cannot atomically create a shared, committed filesystem ticket before allowing the same push.

   The RFC must explicitly amend LLP 0175 and define a closed classifier: runner-controlled setup/provision failures may be infrastructure; ordinary gate failure defaults to content red; nondeterminism requires contradictory determinate executions over an identical verified closure; unknown classification blocks as a control-plane failure. It must also define the durable ticket authority, acknowledgement semantics, and adversarial fixtures for misclassification. The special set-based `module-ownership` protocol must remain outside generic Boolean inherited-red attribution.

3. **D-3 through D-6 conflate two different scheduled proof systems.**

   `CLAUDE.md` expressly distinguishes the two-hour frozen-record drift backstop from LLP 0175 D2.3’s complete canonical battery. Their current contracts differ:

   - the drift runner has pass/stale/infrastructure outcomes and gate-keyed tickets;
   - the canonical proof has `PASS | FAIL | BLOCKED | NOT_SELECTED`;
   - LLP 0189 requires complete-battery tickets keyed by root-failure signature.

   D-3 assigns typed outcomes and retries to the drift backstop. D-4 then publishes complete-battery health containing infrastructure/nondeterministic signatures, while D-6 activates repair coordination from a red complete battery. No contract maps these producers, result types, signature identities, ticket namespaces, or closure rules. As written, implementations could disagree about whether `lastGreen` includes drift-backstop health, whether a `BLOCKED` canonical gate is infrastructure, and which run closes a signature.

   Name the authoritative producer for every health field. Either maintain two explicit ledgers with defined projection rules or introduce one normalized result schema consumed by both runners. Specify that `lastGreen` advances only from a determinate run of the complete canonical inventory, how frozen-record self-health appears in that inventory, and which observation may open, update, or close each ticket.

4. **The repair/revert control plane exceeds the evidence and still contains an unresolved policy decision.**

   The dossier supports D-4’s machine-readable known-red health state: broken-base investigation occurred in 31 sessions. It does not establish repair collisions, pointer-age pressure, or autonomous reverts as material costs. D-6 through D-8 add leases, protected mutation identities, owner suppression, bisect-driven source mutation, and publication recovery around that unevidenced problem. D-7 is safety-conscious, but the complexity and blast radius are disproportionate to the evidence supplied.

   More directly, the RFC says acceptance requires an author ruling on the 24-hour priority and automated-revert authority. Those are normative authority decisions, not implementation details; the document is not ready for acceptance while they remain open.

   Keep the evidence-supported health projection and advisory fix-forward routing. Move automated revert and its mutation authority to a later RFC after the pilot measures repair collisions, time-to-close, and cases where revert would outperform fix-forward. Alternatively, obtain the ruling now and add evidence justifying why autonomous mutation belongs in this RFC.

## Minor findings

- D-2’s “single-digit seconds” and approximately two-minute targets should identify measurement environment, warm/cold state, and percentile; otherwise ten favorable warm runs can satisfy them.
- The readiness receipt’s “source” identity must mean the actual semantics-affecting source closure where reuse is intended. Exact commit identity would recreate the rebase invalidation D-1 is meant to remove.
- D-5 should predeclare a minimum pilot sample and explicit stop conditions. The selected metrics are otherwise appropriate.
- D-4 should define initialization when no completely green battery has yet been observed and recovery when the health projection exists but `refs/heads/green` does not.
- The rollback criteria cover false receipt reuse but should also cover a content failure incorrectly admitted through D-3 classification.

## Evidence-fit assessment

- **D-1 — receipts:** Directly addresses the dominant 10–70 minute re-verification treadmill and the measured 10-minute-battery/8-minute-landing livelock. It is the right primary intervention, but its current invalidation rule defeats actual reuse.
- **D-2 — prepared execution and stable records:** Strong fit. It addresses the heavyweight `auth-invalidation-report`, generated-file conflicts, calendar/exact-commit coupling, and churn-begetting-churn. It appropriately treats prepared runtime as a gate optimization rather than reopening the largely solved worktree-wedge problem.
- **D-3 — typed outcomes:** Strong fit to the 128 raw no-conclusion events and recurring bypass use. The proposed fail-open boundary is insufficiently specified to preserve content safety.
- **D-4 — health record:** Proportionate to the evidenced broken-base triage. Keeping current reds alongside `lastGreen` avoids falsely presenting an old all-green SHA as current health.
- **D-5 — optional branch cuts:** Appropriate restraint. The evidence supports a comparative pilot, not universal green-based branching, and the RFC says so.
- **D-6 — repair coordination:** Root-signature idempotency and fix-forward default align with LLP 0189. Singleton mutation, owner suppression, and the 24-hour policy are not established by the dossier.
- **D-7 — automated revert:** Publication and claim handling are coherent with LLPs 0041 and 0189, especially the recognition that npm bytes are immutable. The automation itself is unevidenced and high-risk.
- **D-8 — control plane:** Least-privilege separation, append-only events, CAS, and partial-state refusal are sound if automated mutation remains in scope. They are excessive for a read-only health pilot alone.
- **Ignored evidence:** D-2 broadly covers dated receipts, toolchain-sensitive records, and regeneration churn. LLP 0189 already addresses complete-proof cancellation. The remaining uncovered signal is guide-freshness warning saturation: the RFC improves generation economics but does not restore the warning’s ability to discriminate new drift.

## Redesign suggestions

1. Accept a narrower first decision consisting of per-gate content receipts, prepared-runtime reuse, rebase-stable record contracts, and a closed typed-outcome protocol.
2. Define one explicit transaction for retry reuse: prior execution receipt → old/new selector bases → recomputed semantic closures → per-gate reuse decisions → new-tree validation receipt.
3. Add a read-only health projection as the second slice, with separate normalized inputs from the canonical battery and drift backstop.
4. Pilot advisory repair routing and optional green cuts before authorizing source mutation. Treat automated revert as a later, independently reviewed decision.

VERDICT: NOT READY
---

## Round 3 — 2026-08-11 (delta round)

**Reviewer family:** gpt
**Provider / runtime:** fresh `codex exec` session, model gpt-5.6-sol,
reasoning effort xhigh, read-only sandbox, cwd = round-3 delta capsule;
launched by the super-refine orchestrator. Not any reviser session.
**Date:** 2026-08-11
**Round:** 3 (delta round per LLP 0010 §2 addendum: rev2 prior text provided
in-capsule; mandatory IN-DELTA vs PRE-EXISTING classification)
**Redacted:** no
**Method:** capsule-scoped codex session (structural exclusion of
`llp/reviews/0232*`); blindness self-attested; reviewer independently
diffed rev2→rev3 and verified D-1/D-3 against the runner, selector,
policy registry, fixtures, and backstop wrapper
**Capsule:** sha256
`6ba38ffc7d03d4b55d1a9b30446c4dc9bf9a0a7a9aefe4cb088bb1bd1a16b29d`
**Bound to revision:** rev3 sha256
`2c96d70ada2d507cc5f6f01571f66912a5b27ffea60c7f052d29d29d2ab9e30f`

Body below is verbatim (codex --output-last-message capture).

---

Blindness attestation: I did not read any `llp/reviews/0232-*` artifact, super-refine run journal, or orchestrator notes, and I had no prior review or authoring context.

Method: I independently diffed revision 2 against revision 3, read LLP 0232 and the evidence dossier, checked compatibility with LLP 0175, LLP 0189, and LLP 0041, and verified D-1/D-3 against `scripts/drift-prone-gates.mjs`, `scripts/select-local-proof.mjs`, `scripts/local-proof-selection-policy.v1.json`, the runner fixtures, and the scheduled backstop wrapper. Review dispositions were treated as unsupported author claims.

## MATERIAL findings

1. **IN-DELTA — The D-3 classifier is not closed because `CONTENT_RED` and `INHERITED_RED` overlap.**

   D-3 defines any “determinate gate failure” as `CONTENT_RED`, while also defining the same determinate content signature reproduced at every merge-base as `INHERITED_RED`. Such a failure satisfies both predicates, yet one outcome blocks and the other proceeds.

   This is not hypothetical relative to the runner: `executeGate` returns one non-infrastructure failure, after which `runPrePush` evaluates its merge-base executions to decide whether it is pre-existing. There is no separate runner category that distinguishes “determinate gate failure” from the failure eligible for inherited attribution.

   Resolve this with mutually exclusive, ordered predicates—for example, classify a determinate content failure as `INHERITED_RED` only when its signature matches every required baseline, and otherwise as `CONTENT_RED`.

2. **IN-DELTA — Allowing `NONDETERMINISTIC` to proceed is an unposed and internally contradictory policy reversal.**

   D-3 permits contradictory determinate executions over an identical closure to proceed. However, “Required amendments and compatibility” says the LLP 0175 reversal is limited to baseline-corroborated runner setup/provision failures and that “all other ambiguity continues to block.” The author-ruling section likewise asks approval only for that narrow infrastructure exception.

   The current runner has no same-closure retry outcome and blocks anything it cannot classify safely. The evidence dossier establishes infrastructure-related landing waste, not a need to admit nondeterministic content verdicts. Contradictory same-closure results leave the pushed content’s state unresolved.

   Either make `NONDETERMINISTIC` blocking, or explicitly pose and justify this additional weakening in the author ruling and required LLP amendments, with corresponding safety acceptance criteria.

3. **IN-DELTA — The required-amendments list omits two direct conflicts with LLP 0175 and the real runner.**

   - LLP 0175’s 2026-08-07 ruling says trigger-matched gates “always run.” D-1 instead permits a selected or always-run gate to reuse a prior result without command execution. The policy and fixtures concretely enforce `module-ownership` as the always-selected gate. Adding receipt fields does not itself amend the existing always-run ruling.
   - LLP 0175 states that failed prepare commands are infrastructure errors, and `executeGate` currently enforces that by supplying `"prepare command failed"` as the infrastructure fallback for every nonzero prepare exit. D-3 narrows `INFRASTRUCTURE` to runner-controlled setup/provision failures, meaning content-caused failures from `bootstrap-ibex-runtime` or deployment codegen must no longer be classified automatically as infrastructure.

   The accepting change must explicitly amend both clauses and require the runner to distinguish runner provisioning failure from gate-owned prepare/content failure.

4. **IN-DELTA — Durable ticket custody is incompatible with the stated write-authority model.**

   D-3 says the pre-push runner creates or updates durable tickets before allowing `INHERITED_RED`, `INFRASTRUCTURE`, or `NONDETERMINISTIC`. D-6 must ensure LLP 0189’s filesystem ticket exists while writing neither source nor `main`; D-8 says no identity defined here may write `main`.

   The actual pre-push runner only reads existing `issues/` tickets. The backstop writes ticket files locally, and `scripts/drift-backstop-runner` commits and pushes those files to `main`. A pre-push hook cannot make a new filesystem ticket durable merely by dirtying the lander’s checkout, and deferring creation to the backstop contradicts D-3’s immediate “creates or updates” contract.

   Define one coherent custody path: either the pre-push runner emits a durable signed ticket request that an explicitly authorized source-ticket publisher projects onto `main`, or an external ticket becomes authoritative and LLP 0189 is amended accordingly. The atomicity and unticketed interval must be explicit.

5. **IN-DELTA — D-1’s singular selector-base receipt cannot validate the runner’s supported multi-ref update topology.**

   `parsePrePushUpdates` accepts multiple updates. `planPrePush` groups updates by local SHA, retains all associated refs, and unions paths computed separately for each remote update; baseline attribution may consequently produce multiple merge-bases. New-branch selection also depends on `--remotes=<remote>`, not a single base commit.

   D-1 binds only an “old selector base,” resolves one “new remote selector base,” and does not bind the complete pre-push ref-update vector. A selector-output digest cannot be independently recomputed unless its full update inputs are retained. This leaves receipt validation under-specified for an already-supported runner case and could transfer a result across a different selection.

   Bind the normalized update vector—remote identity, local/remote refs and SHAs, and all derived bases—or explicitly forbid receipt reuse unless the push contains one eligible ref update.

## Minor findings

1. **IN-DELTA — “Every gate” overstates the D-1 registry scope.**

   The actual policy contains more than 80 canonical gates but only 18 `driftProneGates`. The compatibility section suggests the intended scope is every registered frozen-record gate. D-1 should say that explicitly.

2. **IN-DELTA — The prepared-runtime acceptance threshold is not exact.**

   “p95 at or below about two minutes” is not a mechanically decidable bound. Replace “about two minutes” with an exact duration such as 120 seconds and state how timeout/error runs enter the distribution.

3. **PRE-EXISTING — D-6 drops “consecutive” from LLP 0189’s escalation rule.**

   LLP 0189 escalates a red persisting across four consecutive scheduled runs. LLP 0232 says “four scheduled observations,” which could include interrupted or nonconsecutive observations. Preserve the governing wording.

## Delta assessment

The rewrite materially improves the proposal. D-1 now correctly separates trigger selection from semantic closure, makes reuse per gate, treats registry/closure changes as invalidating, and bounds the Rust-gate economic claim to the evidenced race class. The module-ownership carve-out, unknown-blocks rule, producer-separated ledgers, ticket-close transitions, green-ref initialization/recovery, bounded branch-cut pilot, and deferred revert authority are also directionally sound.

The rewritten contract does not yet hold end to end against the runner. D-1 lacks the runner’s full multi-ref selection identity and conflicts with the existing always-run ruling. D-3’s outcomes overlap, its nondeterministic proceed rule contradicts the stated narrow reversal, and its prepare-failure boundary is not reconciled with either LLP 0175 or `executeGate`. Finally, the ticket promises cannot be realized under the declared no-source/no-`main` authorities. These are decision-level defects affecting whether content-red pushes can proceed and whether required evidence is durable, not implementation-detail requests.

VERDICT: NOT READY