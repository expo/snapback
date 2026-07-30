# LLP 0125 review — Codex family


## Round 1 — 2026-07-30

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** CLI default (medium)
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh CLI runner, read-only sandbox, mutually blind
**Target SHA-256:** `9161587d13febe4f5e156a32c438c810fa44ad2a43ea9d223230fb5d0cff2942`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## Verbatim review

## 1. Overall assessment

LLP 0125 is strong research, especially in correcting the stale impression that application-authored reservation retries remain necessary. Its diary reconciliation, retry-contract verification, performance uncertainty, and ownership mapping are unusually careful.

It does not yet meet the stated READY bar. Two central current-state claims are overbroad, and the option space omits several materially distinct paths. In particular:

- Snapback already has a limited app-authored rejection-code channel for declarative host-plan mutations.
- `SNAPBACK_MUTATION_CONFLICT` is not restricted to authors who explicitly opt into client-supplied CAS baselines.
- Failure-shape unification is analyzed primarily as a wire migration, without examining client-only normalization, preserving the existing split, or the special ambiguity of non-transactional actions.

These are pre-empirical analytical gaps, so they can and should be resolved before implementation.

## 2. Strengths

- The opening correction is excellent. The Summary and “What the 2026-07-28 remediation fixed” distinguish the original bakeoff experience from current behavior instead of carrying a repaired complaint forward ([LLP 0125, lines 26–49](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:26)).

- Provenance hygiene is good. Convex product claims are explicitly labeled “General product background,” while scored comparisons are separately presented as diary evidence ([lines 51–85](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:51)). The cited concurrent-send, diagnostic, remediation, capacity, and action/mutation observations match Diaries 0027, 0028, and 0030.

- The reservation-retry description is code-accurate and precise. The JavaScript client checks the exact HTTP status, diagnostic code, closed detail keys and values, and absence of an ambiguous-commit indication ([index.mjs, lines 3498–3513](/Users/ccheever/projects/snapback/packages/snapback-client/index.mjs:3498)). The 40-attempt and 20–80 ms defaults, authority pinning, bounded diagnostic ring, and scheduled/settled/exhausted evidence are also correctly reported.

- The two OCC mechanisms are usefully separated. The document correctly explains why server-executed JS reads are captured while declarative host-plan CAS baselines must come from the client. That distinction agrees with LLP 0003 and the Guide ([mutations guide, lines 124–147](/Users/ccheever/projects/snapback/guide/backend/mutations.md:124)).

- The handler-code boundary is accurately described for JS/Ibex handlers. Unknown handler-emitted codes collapse to `SNAPBACK_HANDLER_FAILED`, while the runtime preserves only its closed allowlist ([runtime.rs, lines 3149–3192](/Users/ccheever/projects/snapback/src/runtime.rs:3149)).

- The action/mutation transport split is correctly verified. Rejected mutations return an error envelope carrying their terminal receipt, while action execution returns a flattened `FunctionRunResult` at HTTP 200 ([server.rs, lines 17625–17673](/Users/ccheever/projects/snapback/src/server.rs:17625)); `action_run_result` turns failures into `ok: false` plus a diagnostic ([local.rs, lines 1603–1638](/Users/ccheever/projects/snapback/src/local.rs:1603)).

- The performance section is empirically honest. It does not infer current-main latency from stale, cross-machine, or incorrectly profiled receipts. Profiling is correctly named as the prerequisite for performance design.

- The document generally respects decision ownership. It routes prospective changes to LLPs 0003, 0059, 0094, 0108, and 0070 rather than trying to decide their contracts inside a Research LLP.

## 3. Concerns

### C1 — BLOCKING-FOR-BAR: “Domain-typed rejections do not exist” is materially overbroad

Specific gap: Sections “(b) A domain-constraint race,” Option 2, and Finding 4 say that domain-typed rejections do not exist and that the only paved alternatives are unique indexes or success-result unions ([LLP 0125, lines 185–200](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:185), [lines 366–370](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:366)).

That is true for arbitrary JS/Ibex handler-thrown codes and true for generated closed per-operation error unions. It is not true for Snapback as a whole. Declarative host-plan mutations already let authors supply rejection codes through `get(..., {elseError})` and `guard(..., elseError)` ([define.mjs, lines 1750–1760](/Users/ccheever/projects/snapback/packages/snapback-codegen/define.mjs:1750)). Storage emits those codes verbatim in structured handler diagnostics ([storage.rs, lines 3668–3679](/Users/ccheever/projects/snapback/src/storage.rs:3668), [lines 3738–3755](/Users/ccheever/projects/snapback/src/storage.rs:3738)). LLP 0066 already characterizes the state as partial: app-authored codes exist, but no closed generated error union exists.

What would resolve it:

- Narrow the finding to “JS/Ibex handlers lack a declared, closed per-operation rejection union that flows into generated client types.”
- Add the host-plan `guard`/`elseError` channel to the current-state inventory.
- Explain why the capacity example outgrows that IR, if it does.
- Compare extending the existing host-plan rejection mechanism to JS declarations against adding a distinct new envelope member.

### C2 — BLOCKING-FOR-BAR: the document incorrectly restricts mutation conflicts to explicit CAS opt-in

Specific gap: The document says an author sees `SNAPBACK_MUTATION_CONFLICT` “only if they opted into an explicit CAS baseline” ([LLP 0125, lines 176–183](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:176)). This contradicts its own two-lane explanation and Finding 3.

JS mutation reads are captured automatically; an intervening relevant write can therefore produce `SNAPBACK_MUTATION_CONFLICT` without any client-supplied `readSet`. The captured path attaches `retryPolicy: "reject"` ([storage.rs, lines 10609–10620](/Users/ccheever/projects/snapback/src/storage.rs:10609)). The Guide states the same rule explicitly ([mutations guide, lines 22–26](/Users/ccheever/projects/snapback/guide/backend/mutations.md:22), [lines 124–130](/Users/ccheever/projects/snapback/guide/backend/mutations.md:124)).

The chat evidence does establish that the tested authenticated append settled automatically. Its handler reads and patches `channels.nextSequence` ([handlers.mjs, lines 161–177](/Users/ccheever/projects/snapback/demos/backend-bakeoff/arms/chat/snapback/work/snapback/handlers.mjs:161)), and the specific reservation choreography caused the losing invocation to replay from fresh state. That does not establish the universal statement for ordinary JS mutations, unprotected mutations, or other reservation scopes.

What would resolve it:

- Scope “two-actor append: nothing” to the exact protected append path demonstrated by Diary 0028.
- Add a current-state matrix for:

  - protected JS mutation with captured reads;
  - unprotected JS mutation with captured reads;
  - declarative mutation with explicit `readSet`;
  - unconditional mutation;
  - unique-index race.

- Reclassify the frequency of captured-read conflicts in ordinary operation as a named empirical question.

### C3 — BLOCKING-FOR-BAR: the failure-shape option space is incomplete and partly pre-decided

Specific gap: Option 3 says to “pick one contract” and immediately selects rejection with a diagnostic envelope, followed by migration of the action route ([LLP 0125, lines 305–314](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:305)). This omits materially distinct alternatives:

1. Preserve both wire shapes but normalize them in generated clients.
2. Make actions reject while retaining their complete `FunctionRunResult` evidence inside the error envelope.
3. Make mutations resolve a discriminated settlement union.
4. Add a shared client-level `Result`/error abstraction without changing either route.
5. Retain the current split and improve generated helpers and guidance.
6. Keep domain rejection as success-data through LLP 0108 result unions.

Option 2 also moves directly toward a distinct failure-envelope member without fully comparing use of the existing error envelope plus a generated, operation-scoped application-code union. Finally, “option 2 is the highest product-value item” ([lines 343–345](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:343)) is an unsupported prioritization inside an otherwise decision-free analysis.

What would resolve it:

- Add the alternatives above, including status quo.
- Compare each on authoring ergonomics, generated typing, wire compatibility, migration cost, receipt preservation, raw-protocol usability, and ambiguity.
- Remove the unsubstantiated “highest product-value” ranking or supply an explicit evidence-based scoring argument.

### C4 — MATERIAL: action failure is not analyzed against action partial-effect and ambiguity semantics

Specific gap: The action/mutation split is treated principally as an inconsistent promise shape. Actions, however, are not transactions. Mutations already committed through an action remain committed if later action work fails or times out ([LLP 0047, lines 102–113](/Users/ccheever/projects/snapback/llp/0047-hosted-execution-limits.rfc.md:102)). A rejected action promise can therefore look deceptively like a rejected atomic mutation unless the envelope and generated API preserve “prior effects may stand.”

This directly engages LLP 0115’s no-evidence-regression constraint. Option 3 discusses versioning and migration blast radius but not:

- prior committed nested mutations;
- external-effect ambiguity;
- whether automatic client retry is forbidden;
- which execution/result evidence survives;
- whether a common surface can avoid implying common atomicity.

What would resolve it: Add an evidence-preservation and semantic-risk analysis for every failure-shape alternative, explicitly distinguishing mutation no-commit rejection from action failure after partial or ambiguous effects. LLP 0028/0047 should be named as owners or constraints.

### C5 — MATERIAL: Option 1 overstates what the default clients already unify

Specific gap: Option 1 says the default clients already implement the proposed collapse “de facto” ([LLP 0125, lines 277–288](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:277)). The JavaScript client automatically consumes one exact reservation-stale refusal, but it does not synthesize a common conflict code, class, or `cause` for `SNAPBACK_MUTATION_CONFLICT` and `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`. Those remain distinct errors exposed to application code.

What would resolve it: Either describe the current behavior more narrowly as “the client removes one mechanical member from the app-visible taxonomy,” or specify the actual proposed SDK abstraction: shared error superclass, discriminated `cause`, helper predicate, generated operation failure union, or wire-level common member. Those alternatives have different compatibility and evidence consequences.

### C6 — MATERIAL: the remaining options are not systematically checked against no-evidence-regression

Specific gap: Options 1 and 4 discuss evidence explicitly, but the option set lacks a common evaluation against LLP 0115 constraint 1. For example:

- taxonomy unification could hide the exact code or retry eligibility;
- declared domain errors could lose diagnostic detail or terminal receipts;
- action-shape normalization could blur partial-effect ambiguity;
- server-side retry could erase attempt custody or change deterministic-handler obligations.

What would resolve it: Add a compact option matrix with an “evidence preserved or added” column covering exact diagnostic code, refusal details, terminal receipt, attempt history, authority-generation pinning, atomicity/partial-effect signal, and raw-protocol observability.

### C7 — DETAIL: current LLP 0115 relationship should mention OQ6 explicitly

Specific gap: Finding 7 correctly says no CV item currently schedules the remainder, but LLP 0115 v0.4 now names this exact cluster in Open Question 6: failure-shape unification, domain-typed rejections, and current-main burst measurement ([LLP 0115, lines 711–722](/Users/ccheever/projects/snapback/llp/0115-convex-parity-course-corrections.plan.md:711)).

What would resolve it: Clarify that the work is tracked by OQ6 but remains unscheduled pending the author’s absorb-versus-delegate decision. That is more precise than saying only that this research covers unscheduled ground.

### C8 — DETAIL: “Convex makes … fast bursts” should remain measurement-scoped

Specific gap: The comparative synthesis says “Convex makes contention invisible … fast bursts” ([LLP 0125, lines 251–257](/Users/ccheever/projects/snapback/llp/0125-concurrency-and-conflict-ergonomics.research.md:251)). The document elsewhere correctly limits the evidence to one bakeoff measurement and recognizes Snapback’s machine-profile defect.

What would resolve it: Say “the measured Convex arm produced fast bursts” rather than elevating the local measurement into a general product property.

## 4. Suggestions

- Add a small current-state table crossing execution tier, deciding-read location, conflict mechanism, automatic retry owner, application-visible outcome, and evidence retained.

- Separate three concepts currently grouped as “domain-typed rejection”:

  - stable machine-readable application code;
  - a declaration-closed per-operation failure set;
  - a generated TypeScript error/result union.

  Snapback currently has the first on the host-plan lane, lacks the latter two, and collapses arbitrary JS-handler codes.

- Add explicit “status quo” options. Given the successful remediation, keeping unique indexes and result unions as the paved mechanisms is a real option with low migration risk, not merely an absence of action.

- Add primary Convex documentation citations for serializability, automatic OCC retry, deterministic mutation constraints, and `ConvexError`. The provenance label is adequate, but direct sourcing would strengthen the factual layer.

- Replace “three independent diary records” in Confidence with a more exact description such as “two remediation reruns plus the later seven-arm rerun.” The records are valuable, but “independent” is stronger than the document demonstrates.

- Record the exact reviewed commit as `40ca18b9` or explain that verification was performed at the earlier `ba752a14`-era snapshot and rechecked for relevant drift. Current HEAD has advanced, although the inspected conflict and failure mechanisms remain materially the same.

## 5. Open questions

1. Is the intended domain-error gap specifically the JS/Ibex lane, or is the proposed goal one closed failure declaration shared by JS and host-plan functions?

2. Should an app-visible conflict abstraction be a wire contract, a generated operation type, an SDK error superclass/helper, or only a guide convention?

3. What evidence must remain available when an action fails after a nested mutation or external effect has already occurred?

4. Is unifying promise settlement actually the product goal, or would generated exhaustive handling over the existing mutation/action semantics solve the authoring problem with less semantic risk?

5. Under which current execution and reservation profiles can server-captured JS reads reach commit-time conflict without first being serialized by reservation contention?

6. Should LLP 0115 absorb this work as CV-16/CV-17, or should OQ6 delegate it to LLPs 0094/0108/0003/0059 with explicit tracking there?

7. Is automatic retry of deterministic captured-read conflicts intended to remain an option, given that it would require a stronger determinism and evidence contract than the existing effect-free reservation replay?

## 6. Verdict: NOT READY

The document is close, but it has not exhausted pre-empirical analysis. The overbroad claims about existing domain rejection channels and explicit-CAS-only conflicts affect the core current-state model. The missing client-only/status-quo failure-shape alternatives and incomplete treatment of action partial effects leave genuinely distinct options unanalyzed.

These are correctable research defects, not requests for implementation or premature decisions.

## 7. Recommended next step

Revise LLP 0125 in one focused pass:

1. Correct and scope the two current-state claims.
2. Add the execution/conflict matrix.
3. Expand Options 1–3 with host-plan typed codes, client-only normalization, existing-envelope declared errors, success-result unions, and status quo.
4. Evaluate every option against no-evidence-regression and action partial-effect semantics.
5. Convert captured-conflict frequency and current burst behavior into explicit empirical questions.
6. Align the LLP 0115 relationship with OQ6.

Then run a fresh independent re-review against the same READY bar.
