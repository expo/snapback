# LLP 0149 agent application consumption review — Codex family

## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-01
**Redacted:** no (repository access; no secrets in scope)
**Method:** mutually blind — capsule prohibited reading any `llp/reviews/`
artifact concerning LLP 0149; the 14,822-line transcript was searched
afterwards: all eight `llp/reviews/` occurrences are the capsule's own
prohibition, the reviewer's stated intent to exclude, the repo llp-review
skill text it loaded, and incidental mentions inside LLP 0055/0062/0146
body text. Blindness held. SHA-pinned target and instruction capsule;
read-only; no tests executed. The CLI printed the final message twice; it
is recorded once. Session id `019fc11b-379a-7180-987e-ecd039d40a01`;
tokens used 337,407.
**Instruction capsule SHA-256:** `906c85005b80ec976da4a90f8e4856051eedc58498a6242b4c0543020c05708c`
**Target:** `llp/0149-agent-application-consumption.research.md` (725 lines, Draft Research, untracked)
**Target SHA-256:** `870ae34e02fe477f327c2e46c219cc85ad5ab904c00808dc27d0bdba1513cbe2`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 41 (self-reported)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review

# Review of LLP 0149: Agent application consumption

## 1. Overall assessment

**NOT READY, by a wide margin.** The document has a strong architectural core, especially its static/effective separation and journal-first reconciliation. However, six blocking issues remain in the second-model additions: unsafe action retries, unsafe replay semantics, unsupported trust labeling, an overgeneralized provenance model, overstated refusal typing, and a nonexistent read-digest capability. These are factual contradictions or could cause harmful behavior if implemented literally.

## 2. Strengths

- **Verified against source — catalog reuse.** The conclusion that the generated MCP catalog should seed the consumption descriptor is well grounded (`llp/0149-agent-application-consumption.research.md:115`). LLP 0024 already defines function identity, schemas, kind, capabilities, authority, dry-run support, source span, and bundle identity while explicitly separating discovery from permission (`llp/0024-agent-operating-surface.spec.md:430`, `llp/0024-agent-operating-surface.spec.md:475`).

- **Verified against source — static versus effective actionability.** F1 correctly keeps immutable, principal-independent discovery separate from authenticated server decisions (`llp/0149-agent-application-consumption.research.md:128`). LLP 0055 makes grants dynamic, revocable, expiring, and enforced at the shared invocation gate (`llp/0055-agent-principals-and-scoped-grants.rfc.md:1128`, `llp/0055-agent-principals-and-scoped-grants.rfc.md:1139`).

- **Verified against source — journal-first reconciliation.** F5 and R3 correctly prioritize durable operation identity over generic retries or plan tokens (`llp/0149-agent-application-consumption.research.md:218`, `llp/0149-agent-application-consumption.research.md:389`). LLP 0043 supplies the mutation settlement and acknowledgement lifecycle (`llp/0043-offline-replay-retention.rfc.md:219`), while LLP 0062 explicitly names the authority-bound journal and `resolve` as future work (`llp/0062-generated-app-cli-and-code-mode.rfc.md:1512`).

- **Verified against source — per-kind ambiguity discipline.** The distinction among retryable reads, settlement-backed mutations, and actions with terminal unknown outcomes is correct (`llp/0149-agent-application-consumption.research.md:224`). LLP 0147 likewise permits read retries but treats mutations and actions as non-idempotent absent an authoritative mechanism (`llp/0147-compiled-microclient.rfc.md:679`).

- **Verified against source — verification is not product completion.** F9 preserves the important boundary between platform readiness and task success. LLP 0146 says `verify` proves readiness under the application’s declared contract, not that the product or requirements are complete (`llp/0146-agentic-authoring-affordances.rfc.md:451`, `llp/0146-agentic-authoring-affordances.rfc.md:471`).

- **Inferred — sequencing discipline.** The proposed order—descriptor, effective view, durable journal, then preflight/plan tokens—minimizes new semantic machinery and builds on existing identities. That is a coherent and economical implementation strategy once the safety findings below are resolved.

## 3. Findings

### 1. **BLOCKING — A7 turns an unverifiable action promise into retry authorization**

A7 correctly admits that Snapback cannot verify whether an action threads its idempotency key to the external provider, but then says retrying with the same key becomes “app-declared-safe” (`llp/0149-agent-application-consumption.research.md:582`). A declaration alone cannot establish safety: the implementation may omit the key, transform it inconsistently, or call a provider without the promised deduplication semantics.

This contradicts F5, which requires a trustworthy idempotency or receipt mechanism and otherwise makes `outcome-unknown` terminal (`llp/0149-agent-application-consumption.research.md:243`). LLP 0147 also says an idempotent retry class requires an authoritative source and request identity that do not exist today (`llp/0147-compiled-microclient.rfc.md:691`). LLP 0146 states that actions never replay automatically (`llp/0146-agentic-authoring-affordances.rfc.md:939`).

**Resolution:** Treat the declaration as advisory metadata only. Automatic action retry must require an enforced provider-idempotency contract plus durable dispatch/settlement evidence. Otherwise retain terminal `outcome-unknown` and require explicit human or application-specific reconciliation.

### 2. **BLOCKING — A6 changes hermetic transcript playback into live operation replay**

A6 proposes recorded traces that “replay against the current generation in acceptance” (`llp/0149-agent-application-consumption.research.md:572`). That is not what LLP 0062 specifies: `run --replay` executes a script against recorded frames as a hermetic fixture (`llp/0062-generated-app-cli-and-code-mode.rfc.md:1527`).

It also conflicts with LLP 0146’s safety boundary: reads and dry-runs may replay against an exact generation; mutations resolve through settlement and require an isolated branch plus confirmation for re-execution; actions never replay automatically (`llp/0146-agentic-authoring-affordances.rfc.md:939`). Implementing A6 literally could repeat durable or external effects in CI.

**Resolution:** Separate:

1. hermetic script playback against recorded frames;
2. live acceptance execution against seeded isolated state;
3. mutation settlement resolution; and
4. prohibited automatic action replay.

“Current-generation replay” must not be a generic exemplar mechanism.

### 3. **BLOCKING — A4 claims a write-authority fact the cited authorization model cannot derive**

A4 says the server can derive whether non-operator principals may write each returned field from LLP 0053 (`llp/0149-agent-application-consumption.research.md:548`). LLP 0053 instead describes result dependence and whether table changes may alter who can see data (`llp/0053-authorization-invalidation.rfc.md:393`). Its `permissionBacking` and `permissionFields` declarations concern authorization invalidation, not a static enumeration of principals permitted to write each result field (`llp/0053-authorization-invalidation.rfc.md:407`).

Consequently, labeling values `operator-only` could communicate unsupported trust and weaken prompt-injection defenses. The draft’s caveat that operator-written content is not “safe” does not repair the false derivation.

**Resolution:** Remove A4 from the cheap follow-on set. Any future trust signal needs an explicit design based on enforced write policy or recorded value provenance. Until then, returned application content should remain untrusted regardless of apparent author role.

### 4. **BLOCKING — A1 overgeneralizes LLP 0146 conformance and cannot represent its own disagreement state**

A1 says every operation-safety fact can be graded `derived | declared | observed | unknown`, and that LLP 0146 D1 detects false declarations “for free” (`llp/0149-agent-application-consumption.research.md:513`).

D1 observes only declared-versus-captured read and write sets. It explicitly preserves four separate deltas and class-specific provenance; actions have unsupported captures (`llp/0146-agentic-authoring-affordances.rfc.md:339`, `llp/0146-agentic-authoring-affordances.rfc.md:354`, `llp/0146-agentic-authoring-affordances.rfc.md:372`). It does not observe idempotency, external effects, reversibility, or confirmation requirements.

A single provenance grade is also insufficient: disagreement requires a fact to be both declared and observed, with distinct values. A1’s categorical representation cannot express the comparison it promises.

**Resolution:** Model provenance as a set of independent evidence records, not one grade. Name an observation mechanism per field. Scope D1-derived evidence strictly to captured read/write dependencies; leave idempotency and effect claims declared or unknown until dedicated enforcement or observation exists.

### 5. **BLOCKING — the authority table incorrectly says refusal consumption is typed today**

The table says LLPs 0108, 0131, and 0144 make consumption typed in both success and refusal paths (`llp/0149-agent-application-consumption.research.md:111`).

LLP 0144 says the refusal vocabulary is deliberately absent from the served protocol descriptor (`llp/0144-declared-app-refusal-codes.rfc.md:201`), current clients use untyped diagnostic reach-through (`llp/0144-declared-app-refusal-codes.rfc.md:383`), and the guide does not yet ship the channel (`llp/0144-declared-app-refusal-codes.rfc.md:594`). Declaration and server admission have landed; consumable protocol enumeration and generated client typing have not.

**Resolution:** Describe the current state as a typed server-side admission and diagnostic carrier foundation. Make descriptor enumeration and generated refusal unions explicit dependencies on LLP 0144’s unresolved surface decisions.

### 6. **BLOCKING — A2 attributes read digests to LLP 0093 that it does not expose**

A2 says the read path already exposes version/digest identities and that LLP 0093 names them (`llp/0149-agent-application-consumption.research.md:524`). LLP 0093 identifies the live-frame `version` only as the storage commit version (`llp/0093-client-protocol-and-native-clients.rfc.md:213`); it does not define a query-result digest.

The document later recognizes this as unresolved, asking whether the precondition should use a commit version, query-result digest, or narrower identity (`llp/0149-agent-application-consumption.research.md:679`). A2 therefore presents its own open design question as existing machinery.

**Resolution:** State only that a global storage commit version exists. Keep query digests and narrower read identities open until their semantics, ownership, and comparison scope are designed.

### 7. **MATERIAL — A5 treats legitimate effective-view staleness as a server defect**

F1 correctly calls the effective view short-lived (`llp/0149-agent-application-consumption.research.md:139`), but A5 says disagreement between that view and a later refusal is necessarily a server defect (`llp/0149-agent-application-consumption.research.md:562`).

Grants can expire or be revoked, manifest activation can invalidate scope, and the shared gate rechecks authority at invocation (`llp/0055-agent-principals-and-scoped-grants.rfc.md:1118`, `llp/0055-agent-principals-and-scoped-grants.rfc.md:1139`). A previously correct view can therefore disagree with a later call without either computation being defective.

**Resolution:** Bind the effective view to generation, authority-instance identity, observation time, and expiry. Define three outcomes: prediction matched, view stale, or invariant violated. Only the last is a server defect.

### 8. **DETAIL — the journal state diagram leaves ACK applicability ambiguous**

The generic diagram permits `settled → durably-consumed → acknowledged` without marking those transitions mutation-only (`llp/0149-agent-application-consumption.research.md:238`). The following prose supplies the distinction, but the diagram is likely to be reused independently. LLP 0043’s durable-consumption and ACK lifecycle specifically governs mutation settlements (`llp/0043-offline-replay-retention.rfc.md:219`).

**Resolution:** Annotate transitions by operation kind, with queries reissuable, mutation settlements ACK-capable, and unresolved actions terminal.

## 4. Suggestions

- Promote the descriptor admission rule from “Sharpenings” into R1: every field should name its producer, owning authority, consumer decision, disclosure class, volatility, and evidence type.
- Add one operation-kind matrix covering dispatch identity, safe retry, reconciliation, ACK, preflight, and replay. This would expose semantic leakage between reads, mutations, and actions.
- Distinguish “landed,” “accepted but future,” and “research proposal” in the existing-authority table. Several current overstatements arise from collapsing those states.
- Rename A6 to “hermetic exemplar playback” and reserve “execution” for isolated, effect-aware acceptance scenarios.
- Make staleness and snapshot identity part of the effective-view result shape before treating it as a refusal predictor.

## 5. Open questions

- Can Snapback acquire trustworthy per-value write provenance without a new write-path contract, or should trust labeling remain entirely outside this work?
- What is the narrowest useful precondition identity: global commit version, query-result digest, declared read-set digest, or an application-owned version?
- Can provider idempotency be enforced and evidenced uniformly enough to support an action retry class, or must it remain application-specific?
- Will refusal vocabulary become part of the served descriptor, remain codegen-only, or be available through a separate authenticated lookup?
- How should an effective-view receipt distinguish authority expiry, manifest change, target-capability change, and an actual server inconsistency?

## 6. Recommended next step

Revise LLP 0149 before producing an implementation RFC: remove or redesign A4 and A7, recast A6 as hermetic playback, narrow A1 to evidence that actually exists, correct the refusal and read-digest claims, and version-bind the effective view. Then repeat this claim-by-claim review against the corrected draft.

Tool-use count: 41. The review was read-only; no tests were run and no repository files were modified.

NOT READY

## Round 2 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-01
**Redacted:** no
**Method:** delta-scoped round 2 — family-conditioned blindness: permitted to
read its own round-1 artifact (`0149-*.codex.md`); prohibited from the fable
artifact and the super-refine journal. Transcript (3,624 lines) searched
afterwards: neither the 0149 fable artifact nor the 0149 journal appears;
the only review-artifact paths touched are other numbers' (0094/0133/0144/
0134), which the capsule permits. SHA-pinned target
(v0.2) and instruction capsule; read-only; no tests executed. The CLI printed
the final message twice; recorded once. Tokens used 116,423.
**Instruction capsule SHA-256:** `54542119545b3f4c51bb3c8927d8e9013b3efcd460ad917dda298e1231000a65`
**Target:** `llp/0149-agent-application-consumption.research.md` (836 lines, v0.2, Draft Research, untracked)
**Target SHA-256:** `ffd053bb98b6a45c76b003f1833c193370f069fa3594956e9a87cb0cd147b8c2`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 27 (self-reported)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review (round 2)

# LLP 0149 agent application consumption review — Codex family

## 1. Overall assessment

**NOT READY, by a moderate margin.**

All eight Codex round-1 findings are resolved at their original anchors. The revised A1/A2/A4/A5/A6/A7 text is substantially safer and more accurate.

However, the delta review found five material defects: two new factual misclassifications, two internal contradictions left by displaced text, and one authority-boundary collapse involving LLP 0144. None invalidates the central descriptor-first, journal-before-plan-tokens direction, but the Draft Research bar requires every factual and ownership claim to be true.

## 2. Round-1 resolution table

| # | Prior finding | Status | Verification |
|---|---|---|---|
| 1 | A7 treated a declared action idempotency key as retry authorization | **Resolved** | A7 now says the declaration licenses no automatic behavior, keeps `outcome-unknown` terminal, and limits the key to human or app-specific reconciliation (`llp/0149-agent-application-consumption.research.md:679-691`). This matches LLP 0147’s requirement for an authoritative source, request identity, and artifact carrier (`llp/0147-compiled-microclient.rfc.md:692-711`). A separate displaced Slice 2 inconsistency is new finding 4. |
| 2 | A6 confused hermetic transcript playback with live operation replay | **Resolved** | A6 now separates hermetic playback against recorded frames from live acceptance on seeded disposable state and explicitly rejects live replay of recorded effects (`llp/0149-agent-application-consumption.research.md:660-677`). This matches LLP 0062’s `run --replay` contract (`llp/0062-generated-app-cli-and-code-mode.rfc.md:1527-1533`) and LLP 0146’s per-kind replay limits (`llp/0146-agentic-authoring-affordances.rfc.md:939-947`). |
| 3 | A4 claimed write-authority-derived trust labels that LLP 0053 could not supply | **Resolved** | A4 now identifies imperative `ctx.auth` checks and draft write rules as insufficient provenance, requires all application values to remain untrusted, and gates positive labels on enforced write policy or recorded value provenance (`llp/0149-agent-application-consumption.research.md:625-643`; `llp/0011-auth-and-permissions.rfc.md:181-196,256-263`). |
| 4 | A1 collapsed evidence into one grade and overstated LLP 0146 observation | **Resolved** | A1 now models independent evidence records, permits declared/observed disagreement, and limits observation to captured read/write dependencies (`llp/0149-agent-application-consumption.research.md:578-595`). That matches LLP 0146’s four deltas and per-class provenance (`llp/0146-agentic-authoring-affordances.rfc.md:346-375`). |
| 5 | Authority table claimed refusal consumption was typed today | **Resolved** | The row now distinguishes server-side declaration/admission from untyped client reach-through and calls descriptor exposure an unresolved dependency (`llp/0149-agent-application-consumption.research.md:120`). This matches LLP 0144’s landed floor (`llp/0144-declared-app-refusal-codes.rfc.md:192-208,383-387`). |
| 6 | A2 attributed a query-result digest to LLP 0093 | **Resolved** | A2 now names only the global storage commit version and explicitly says no query-result digest or narrower identity exists (`llp/0149-agent-application-consumption.research.md:597-607`; `llp/0093-client-protocol-and-native-clients.rfc.md:213-214`). A separate new ownership contradiction appears in finding 5. |
| 7 | A5 classified every effective-view/call disagreement as a server defect | **Resolved** | A5 now binds the view to generation, authority instance, observation time, and expiry, distinguishing match, staleness, and invariant violation (`llp/0149-agent-application-consumption.research.md:653-658`). |
| 8 | Journal diagram left ACK applicability ambiguous | **Resolved** | The diagram marks durable consumption and acknowledgement mutation-only, and the new per-kind matrix distinguishes queries, mutations, actions, and subscriptions (`llp/0149-agent-application-consumption.research.md:261-282`). |

## 3. New findings

### 1. MATERIAL — F1’s dry-run “witness” compares different authority planes

F1 says the generated catalog’s `dryRunSupported: false` disagrees with effective capability because the server serves `mutationDryRun` (`llp/0149-agent-application-consumption.research.md:164-168`).

The catalog does hardcode `false` (`packages/snapback-cli/mcp-control.mjs:128-147`), but the served operation is the operator-plane `function.explain` host op, which derives dev-user authority (`src/host_ops.rs:1686-1702`). LLP 0055 explicitly says scoped agents have no dry-run surface and therefore report `dryRun: false` (`llp/0055-agent-principals-and-scoped-grants.rfc.md:1322-1325`). F4 itself states the same boundary (`llp/0149-agent-application-consumption.research.md:211-217`).

For the consuming agent in scope, the static declaration and effective availability agree today. The claimed disagreement is produced by switching principals and planes.

**Resolution:** Remove this witness or describe it as a cross-plane latent capability, not a static/effective disagreement. The future descriptor should distinguish runtime support, projection availability, target support, and current-authority reachability.

### 2. MATERIAL — F6 misclassifies fixed token and route controls as grant ceilings

F6 says LLP 0055’s grant model carries “TTL, live-token caps, and throttles” today (`llp/0149-agent-application-consumption.research.md:301-303`).

Only grant expiry is a configurable grant fact. The grant record contains scopes and `expires_at`, but no call, concurrency, spend, or throttle field (`llp/0055-agent-principals-and-scoped-grants.rfc.md:920-944`). The ten-token limit is a fixed carrier-custody cap with oldest-token eviction (`llp/0055-agent-principals-and-scoped-grants.rfc.md:900-903`), not a per-grant call-concurrency budget. The cited throttles govern registration, invitation, and pairing routes (`llp/0055-agent-principals-and-scoped-grants.rfc.md:1154-1165`), not invocation consumption under a grant.

This distinction is load-bearing for a task compiler: a fixed platform guardrail is neither requestable nor reviewable consent.

**Resolution:** Inventory separately:

- configurable grant facts: scopes and expiry;
- fixed platform limits: live-token caps and auth-route throttles; and
- proposed grant ceilings: call count, invocation concurrency, spend, and effect class.

### 3. MATERIAL — A5 collapses application refusals and platform actionability across LLP 0144’s explicit boundary

A5 says effective-view answers and call refusals “are the same vocabulary” (`llp/0149-agent-application-consumption.research.md:645-658`). The smaller note likewise assigns budget and rate retry facts to “the LLP 0144 vocabulary” (`llp/0149-agent-application-consumption.research.md:703-708`).

LLP 0144 explicitly preserves the opposite boundary:

- application codes occupy `appCode` beside, never instead of, platform codes (`llp/0144-declared-app-refusal-codes.rfc.md:192-220,225-230`);
- host auth, capability, and protocol denials remain terminal, uniform, and outside the application channel (`llp/0144-declared-app-refusal-codes.rfc.md:241-242`); and
- application refusals are caller-visible bytes raised from inside permission-gated handlers (`llp/0144-declared-app-refusal-codes.rfc.md:243-248`).

An effective view can predict pre-dispatch grant, capability, and budget gates. It cannot generally predict business-state refusals such as `INVITE_CONSUMED` without executing application logic—the very cost and enumeration problem OQ4 leaves open (`llp/0149-agent-application-consumption.research.md:761-762`).

**Resolution:** Keep separate platform-actionability and application-refusal namespaces. Require equivalent reasons/remediations only where an effective-view fact predicts the same platform gate that later refuses invocation. Put platform budget/rate retry facts under the diagnostic, authorization, or lifecycle owner—not LLP 0144—unless the application itself declares and raises that refusal.

### 4. MATERIAL — Slice 2 retains the unsafe “declared seam” threshold A7 removed

F5 requires an **owning, trustworthy** idempotency or receipt contract before an action can resolve; otherwise `outcome-unknown` is terminal (`llp/0149-agent-application-consumption.research.md:267-272`). Rewritten A7 correctly says a declared promise licenses nothing automatic and keeps unknown terminal (`llp/0149-agent-application-consumption.research.md:679-691`).

Slice 2 nevertheless says to preserve terminal unknown only for actions “without a declared idempotency seam” (`llp/0149-agent-application-consumption.research.md:481-486`). That lower threshold lets an implementation reader infer that declaration alone changes journal terminality.

**Resolution:** State that Slice 2 keeps every action terminal at the generic engine. It may record a declared key for human or app-specific reconciliation, but only a separately designed and enforced owning contract may introduce a nonterminal resolution class.

### 5. MATERIAL — A2 settles ownership that OQ13 still leaves open

A2 correctly keeps the read identity open, but then says version-precondition semantics are “owned by the existing settlement path” (`llp/0149-agent-application-consumption.research.md:597-611`). OQ13 later asks whether the existing conflict/settlement path can own that comparison without another evaluator (`llp/0149-agent-application-consumption.research.md:786-789`).

Those positions cannot both hold. LLP 0133 proves that mutation receipts bind committed `snapshotVersion` (`llp/0133-local-settlement.spec.md:414-420,533-548`), but that does not decide where a pre-invocation comparison is admitted or evaluated.

**Resolution:** Make the conflict/settlement path a candidate owner, not the decided owner. Leave carrier, admission order, and comparison ownership open. Also qualify “covers most of it”: global commit-version equality is safe but may stale on unrelated writes, so its usefulness needs measurement.

## 4. Suggestions

- Add `volatility/snapshot identity` and `evidence type` to R1’s field-admission rule alongside producer, consumer decision, and disclosure class.
- Give the authority table an explicit maturity column instead of explaining that it “necessarily collapses” shipped, accepted-future, and proposed states.
- For A6, require any action test double to have an identity, isolation witness, and enforced no-live-provider contract before it can support acceptance claims.
- Apply the next corrections by replacing the defective sentences rather than appending caveats. At +15.3% over v0.1, only about 4.7 percentage points remain in the stated growth budget.

## 5. Open questions

- Is the effective view intentionally limited to platform pre-dispatch gates, or is some bounded application-refusal evaluation actually proposed?
- What exact evidence elevates an action from human-assisted reconciliation to an engine-recognized resolvable class?
- Is global commit-version preconditioning expected on one-shot queries, live-query observations, or both, and what unrelated-write rejection rate is acceptable?
- Which task limits are user-consented grant parameters versus fixed target or broker guardrails?

## 6. Recommended next step

Revise LLP 0149 while keeping it Draft: remove the cross-plane dry-run witness, correct the grant-limit inventory, split platform actionability from LLP 0144 application refusals, align Slice 2 with A7’s declaration-only posture, and reopen A2’s comparison owner. Then run a narrow round-3 dual-family review over those five corrections.

Tool-use count: 27 read-only review tool invocations. No tests were run and no repository files were modified.

NOT READY

## Round 3 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-01
**Redacted:** no
**Method:** narrow delta round over the ten enumerated v0.3 changes;
family-conditioned blindness (own artifact both rounds allowed). Transcript
(2,893 lines) searched afterwards: the only 0149-artifact path occurrences
are the capsule's own prohibition text and the target's Summary line.
Blindness held. SHA-pinned target and capsule; read-only; no tests. Final
message printed twice by the CLI; recorded once.
**Instruction capsule SHA-256:** `ce41d5fe689881a322f1f11d83a3a155edea3355d1601de852c7ead6d4a380c3`
**Target:** `llp/0149-agent-application-consumption.research.md` (871 lines, v0.3, Draft Research, untracked)
**Target SHA-256:** `3e996b3fe761bab4ea91256261912b43db9539ab56ca529a52188de8b68e26a6`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 19 orchestration calls / 29 shell invocations (self-reported)
**Status:** completed
**Verdict:** NOT READY

## Verbatim review (round 3)

# LLP 0149 agent application consumption review — Codex family, round 3

## Overall assessment

**NOT READY, by a narrow margin.**

The target SHA-256 was verified as `3e996b3fe761bab4ea91256261912b43db9539ab56ca529a52188de8b68e26a6`.

All five round-2 findings are substantively resolved, and the document’s central descriptor-first, journal-before-plan-tokens direction is ready. Two material defects remain in newly revised text: A6 conflates the value-free audit lane with full-value transcripts and consequently overstates hermetic replay as “safe anywhere”; the earliest-retry note presents LLP 0144’s open disposition question as though it reserved a usable protocol slot. One citation detail also attributes budget denials too directly to LLP 0144 I6.

These are localized corrections, not architectural failures, but the standing bar requires factual and ownership claims to remain honest.

## Round-2 resolution table

| # | Round-2 finding | Status | Verification |
|---|---|---|---|
| 1 | F1 treated an operator-plane dry-run as a static/effective disagreement for consuming agents | **Resolved** | F1 now expressly says both surfaces are unavailable to the scoped consuming agent and uses the example only to show that one boolean cannot distinguish runtime support, projection availability, target support, and authority reachability (`llp/0149-agent-application-consumption.research.md:163-171`). The implementation still hardcodes the catalog flag at `packages/snapback-cli/mcp-control.mjs:144`, while `src/host_ops.rs:1686-1701` serves `mutationDryRun` through dev-user host authority. |
| 2 | F6 misclassified token caps and auth-route throttles as configurable grant ceilings | **Resolved** | The limit inventory now separates configurable scopes/expiry, the fixed ten-token and auth-route guardrails, and proposed call-count/concurrency/spend/effect ceilings (`llp/0149-agent-application-consumption.research.md:295-310`). This matches LLP 0055’s fixed caps (`llp/0055:898-905`), grant fields (`llp/0055:920-944`), and route table (`llp/0055:1154-1169`). |
| 3 | A5 collapsed platform actionability and application refusals across LLP 0144’s boundary | **Resolved in substance** | A5 now preserves separate platform and `appCode` namespaces, limits prediction to platform gates, and distinguishes matched, stale, and invariant-violating results (`llp/0149-agent-application-consumption.research.md:665-686`). The smaller earliest-retry note correctly assigns platform denials to diagnostic/authorization owners (`llp/0149-agent-application-consumption.research.md:738-743`), but introduces a new carrier overstatement addressed in finding 2 below. |
| 4 | Slice 2 let a declaration alone change action-journal terminality | **Resolved** | Slice 2 now keeps every unresolved action terminal in the generic engine, records a declared key only for human or application-specific reconciliation, and requires a separately designed and enforced owning contract for any nonterminal class (`llp/0149-agent-application-consumption.research.md:493-500`). |
| 5 | A2 settled the precondition comparison owner while OQ13 left it open | **Resolved** | A2 now calls the conflict/settlement path only the natural candidate, explicitly leaves admission and evaluation to OQ13, and records the unrelated-write staling cost of a global commit version (`llp/0149-agent-application-consumption.research.md:612-631`). The existing identities are accurately bounded by LLP 0093’s live-frame commit version (`llp/0093:213-214`) and LLP 0133’s committed `snapshotVersion` (`llp/0133:414-420,533-548`). |

## New findings

### 1. MATERIAL — A6 conflates value-free audit records with full-value replay transcripts

A6 describes hermetic playback as replaying a value-separated trace with “values replayed value-free by default, per 0062’s transcript design,” and concludes that it is “safe anywhere” (`llp/0149-agent-application-consumption.research.md:688-695`).

LLP 0062 defines two different artifacts:

- its ordinary audit lane is value-free by default, while full-value recording is explicitly opt-in (`llp/0062-generated-app-cli-and-code-mode.rfc.md:628-664`);
- the future transcript records full call and subscription result documents, with values kept separate and explicitly authorized (`llp/0062-generated-app-cli-and-code-mode.rfc.md:1527-1533`).

LLP 0062 does not define value-redacted frame semantics. A script whose control flow depends on returned values may not replay meaningfully after those values are removed. A full-value transcript can also contain sensitive application data, so hermetic execution makes it effect-safe, not confidentiality-safe “anywhere.” OQ16 correctly leaves mechanical redaction and public-envelope eligibility open (`llp/0149-agent-application-consumption.research.md:832-834`), contradicting the stronger A6 wording.

**Resolution:** Distinguish effect hermeticity from data safety. State that playback uses recorded frames which may contain explicitly authorized values and therefore remains subject to transcript custody and disclosure rules. Leave value-redacted/public fixtures open under OQ16 until their frame semantics and behavior when values are omitted are designed.

### 2. MATERIAL — The earliest-retry note invents a reserved LLP 0144 slot

The smaller note says an application-declared refusal can carry a machine-readable earliest-retry fact “through the slot 0144 reserves” and cites LLP 0144’s summary (`llp/0149-agent-application-consumption.research.md:738-743`).

LLP 0144 reserves a **design question**, not a field or protocol slot. Its landed position is that declared refusals participate in no retry or quarantine dispositions (`llp/0144-declared-app-refusal-codes.rfc.md:423-429`). Possible hints remain options, and their owner is explicitly unresolved in OQ3 (`llp/0144:430-458,688-692`). Current untyped `appDetails` could contain an application-specific value, but that is not a standardized machine-readable earliest-retry contract.

This turns an open ownership and wire-shape question into apparent existing machinery.

**Resolution:** Say that a future LLP 0144 owning amendment could standardize an application-refusal retry hint. Until then, application refusals have no standard earliest-retry field or disposition behavior; any value in `appDetails` is application-specific and untyped.

### 3. DETAIL — A5’s LLP 0144 I6 anchor does not directly cover budget denials

A5 groups grant, capability, and budget gates together, then attributes the outside-the-application-channel rule to LLP 0144 I6 (`llp/0149-agent-application-consumption.research.md:665-672`).

I6 directly names host auth, capability, and protocol denials (`llp/0144-declared-app-refusal-codes.rfc.md:241-242`); it does not name budget or rate denials. The broader namespace separation remains correct through I2 and the platform diagnostic model, and the later smaller note correctly gives platform budget/rate facts different owners.

**Resolution:** Anchor auth and capability denials to I6, but describe budget gates as proposed platform-owned denials whose vocabulary belongs to their eventual diagnostic/authorization/budget owner.

## Suggestions

- Make the v0.4 correction surgical: replace the defective A6 parenthetical and “safe anywhere” phrase rather than expanding the section.
- Use “effect-hermetic” for replay against recorded frames; reserve “safe to distribute” for fixtures that satisfy a separately specified redaction and custody contract.
- Replace “slot 0144 reserves” with an explicit future amendment dependency.
- Add a direct LLP 0058 section anchor to R4’s otherwise-supported ownership statement; `llp/0058:1049-1226` contains the shared authority type layers and invocation gate.

## Open questions

- Are exemplar transcripts intended to remain full-value, target-local fixtures, or will there be a second redacted fixture class suitable for public envelopes?
- If redacted replay is desired, what deterministic substitute preserves script branching when a recorded value is removed?
- Should standardized application earliest-retry hints extend LLP 0144 Axis E, or belong to a generic diagnostic/lifecycle vocabulary projected into both namespaces?
- Are budget gates in A5 merely anticipated future gates, or is there an existing platform budget refusal family the owning RFC should name?

## Recommended next step

Revise LLP 0149 in place while keeping it Draft: correct A6’s transcript and confidentiality claims, reopen the application earliest-retry carrier under LLP 0144 OQ3, and narrow the I6 citation. No new evidence or architectural work is needed. After those exact corrections, one final narrow verification should be sufficient; the rest of the document meets the standing Research bar.

Tool-use count: 19 read-only orchestration calls comprising 29 shell invocations. No tests were run and no repository files were modified.

NOT READY

## Round 4 — 2026-08-02

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0 `codex exec`, model `gpt-5.6-sol`,
reasoning effort xhigh, sandbox read-only, approval never
**Date:** 2026-08-02
**Redacted:** no
**Method:** final-verification round over the seven enumerated v0.4 changes;
family-conditioned blindness (own artifact all rounds allowed). Transcript
(2,841 lines) searched afterwards: the only 0149-artifact path occurrences
are the capsule's own prohibition text and the target's Summary line (read
twice). Blindness held. SHA-pinned target and capsule; read-only; no tests.
Final message printed twice by the CLI; recorded once.
**Instruction capsule SHA-256:** `123754b033d8787701ef1974fb5eea196f524a455046122443d90db896479eb3`
**Target:** `llp/0149-agent-application-consumption.research.md` (885 lines, v0.4, Draft Research, untracked)
**Target SHA-256:** `f7e42d2fec4caca1d0ad914894400f1a9c94a6553841c24700afd4aa6c14c890`
**Repo revision at review start:** `main` `67628399`
**Tool uses:** 10 (self-reported)
**Status:** completed
**Verdict:** NOT READY (citation-only: one stale moving anchor; reviewer
states that after the mechanical correction the dual-family review can be
treated as converged)

## Verbatim review (round 4)

# LLP 0149 agent application consumption review — Codex family, round 4

## Overall assessment

**NOT READY, by a razor-thin margin.**

The required SHA-256 was verified as `f7e42d2fec4caca1d0ad914894400f1a9c94a6553841c24700afd4aa6c14c890`.

All two MATERIAL findings and the DETAIL finding from Codex round 3 are resolved. The seven v0.4 changes introduce no substantive factual, safety, or ownership defects. One new DETAIL remains: A7’s claim is correct, but its LLP 0147 line citation drifted and no longer supports the complete paraphrase at the cited altitude.

This is a citation-only defect. The document otherwise meets the Draft Research bar, including its deliberate preservation of open design questions.

## Prior-round resolution table

| Round-3 item | Status | Verification |
|---|---|---|
| **MATERIAL:** A6 conflated the value-free audit lane with full-value transcripts and called hermetic replay “safe anywhere” | **Resolved** | A6 now distinguishes effect-hermetic playback from distribution safety, identifies the audit lane and transcript as separate LLP 0062 artifacts, keeps fixtures under transcript custody, and routes value-redacted fixtures and branch semantics to OQ16 (`llp/0149-agent-application-consumption.research.md:692-705`). This matches LLP 0062’s value-free audit lane and opt-in recording (`llp/0062-generated-app-cli-and-code-mode.rfc.md:628-664`) and its full-result transcript/replay design (`llp/0062-generated-app-cli-and-code-mode.rfc.md:1527-1533`). |
| **MATERIAL:** The earliest-retry note invented a reserved LLP 0144 protocol slot | **Resolved** | The note now says no standard application-refusal carrier exists, identifies E1 as the landed no-disposition behavior, leaves hints and ownership under OQ3, and keeps `appDetails` application-specific and untyped (`llp/0149-agent-application-consumption.research.md:747-757`). This matches LLP 0144 Axis E (`llp/0144-declared-app-refusal-codes.rfc.md:423-458`), OQ3 (`llp/0144-declared-app-refusal-codes.rfc.md:688-692`), and current untyped client reach-through (`llp/0144-declared-app-refusal-codes.rfc.md:383-395`). |
| **DETAIL:** A5 attributed budget denials directly to LLP 0144 I6 | **Resolved** | A5 now anchors only host auth and capability gates to I6 and labels budget gates as proposed platform-owned denials whose vocabulary belongs to their eventual diagnostic/authorization owner (`llp/0149-agent-application-consumption.research.md:667-676`). LLP 0144 I6 directly covers auth, capability, and protocol denials (`llp/0144-declared-app-refusal-codes.rfc.md:241-242`). |

## Remaining v0.4 change checks

| Change | Result |
|---|---|
| R4 added the LLP 0058 invocation-authority anchor | **Verified.** The ownership statement at `llp/0149-agent-application-consumption.research.md:460-468` matches LLP 0058’s shared authority type layers and invocation gate (`llp/0058-shared-invocation-authority-and-staged-auth-mode-protocol.spec.md:1049-1226`). |
| LLP 0144 overlap citation widened to lines 201–208 | **Verified.** Those lines directly establish that refusal declarations reach codegen but remain absent from the served protocol descriptor. |
| A7 added “compile-time diagnostic” | **Correct in substance; citation drifted.** See the new DETAIL below. |
| Revised header records v0.4 | **Verified.** The entry at lines 9–14 accurately summarizes the applied round-1 through round-3 corrections. |

## New findings

### DETAIL — A7’s LLP 0147 line citation no longer reaches the complete admission bar

A7 correctly says a future declared retry input must name its authoritative source, request identity, artifact carrier, and compile-time diagnostic (`llp/0149-agent-application-consumption.research.md:721-730`).

The cited range, `llp/0147:704-711`, now covers generated wrapper typing and the beginning of kind-derived retry policy. The complete four-part requirement appears at `llp/0147-compiled-microclient.rfc.md:721-726`, including “compile-time diagnostic.”

The substance and ownership are correct; only the moving line anchor is stale.

**Resolution:** Change the citation to `llp/0147:721-726`, or use a stable section anchor that reaches the same paragraph.

No other new defects were found in the seven v0.4 changes or the whole-document pass.

## Suggestions

- Because LLP 0147 is under concurrent revision, prefer a stable section anchor for A7 if the corpus convention permits it.
- Make only the citation correction; no substantive expansion or reopening of the converged design is warranted.

## Open questions

No new reviewer question blocks convergence. OQ16 correctly retains value-redacted fixture semantics as open, and LLP 0144 OQ3 correctly retains application retry-hint ownership as open. Neither is presented as settled elsewhere in v0.4.

## Recommended next step

Correct A7’s LLP 0147 citation while keeping the document Draft. After a mechanical verification of that anchor, the dual-family review can be treated as converged; no additional no-new-evidence model-review round is warranted. Any status transition remains the author’s decision.

Tool-use count: 10 read-only tool invocations. No tests were run and no repository files were modified. I read only the permitted Codex artifact; I did not read the Fable artifact or the super-refine journal.

NOT READY
