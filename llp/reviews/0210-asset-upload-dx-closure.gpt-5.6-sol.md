# Review artifact — LLP 0210 (asset upload DX closure) — family: gpt-5.6-sol

## Round 1 — 2026-08-09

- Reviewer: Codex CLI `gpt-5.6-sol`, `model_reasoning_effort=xhigh`,
  read-only sandbox rooted at the capsule; mutually blind.
- Target revision sha256:
  `5e3d310b165777bbdc8d50de3ba216f12e8f985fc99e30c55b1025b3447da1d7`
- Capsule sha256:
  `590864da49af5471408c81716c459e0622b2e60cffd565c6dbd4fd3791b5b3c6`
- Instructions sha256:
  `64e8fd22e6e6899bdf655ed9754ac9100f7afb93ea1c1551e8d0cc9a1fb1689b`
- Received: complete, well-formed. Verdict: **NOT READY** (6 MATERIAL).

### Review body (verbatim)

## Summary

LLP 0210 closes the pilot’s upload and delivery DX gaps by adding client-side signed issuance and refresh, defaulting issuance to `primary` with typed refusals, adding one-call upload, improving the asset-mapping diagnostic, and adopting a recipient-authority ladder: documented grant rows now, first-class grant operations next, app-bound sharing later.

The direction is strong and well grounded in the pilot. However, D1, D3, D4, and D5 contain unresolved contract or authority defects, so the document is not ready.

## Strengths

- Keeping `assets.signedUrl()` as an explicit, uncached issuance call is sound. The existing client already centralizes bearer/protocol custody, while the pilot’s cache was keyed only by asset/options rather than authority; hidden method-level caching would make that mistake easy to reproduce (`packages-excerpts/asset-client-custody-excerpt.txt`; `pilot-record/data.ts`).
- D2’s empty-body default and typed request/variant refusals directly address the observed 422 and probing loop (`pilot-record/diary.md` §M4; `pilot-record/run-log.md` M4; `issues/20260809-asset-upload-dx-papercuts-g11.md`).
- D3 correctly keeps `assets.start()` as the rich task surface and makes `upload()` a deliberately lossy happy-path convenience.
- D5’s sequencing is proportionate to the evidence: the recipe is already pilot-proven, grant operations remove a specific field-patching idiom, and app-bound sharing belongs with the broader dual-roster program (`pilot-record/run-log.md` M4/M5; `llp/0208-clique-pilot-gap-closure.plan.md` G4/G11).

## Concerns

### MATERIAL — D4: required-child → optional-argument refusal is not justified

**Section:** D4, “Rule.”

**Defect:** A required command child mapped into an optional mutation argument is type-safe: the generated command narrows the more general mutation and always supplies the argument. Other callers retaining the mutation’s text-only branch creates no contract disagreement; wrappers routinely impose stronger preconditions than the functions they call. LLP 0180 itself says the pairing is “semantically satisfiable,” and its input-derivation rule already gives the command its own mechanically derived signature (`llp/0180-asset-bearing-client-commands.rfc.md` §§Declaration, dated 2026-08-09 note).

The chosen refusal also weakens the authored command contract by forcing `optional: true` and recovering requiredness through handler validation—the exact workaround the pilot had to discover (`pilot-record/diary.md` §M4; `issues/20260809-asset-upload-dx-papercuts-g11.md` §3).

**Suggested resolution:** Admit required child → optional `v.assetRef` when intent compatibility holds. Generate a required command input and always populate the optional mutation argument. Continue refusing the unsafe inverse—optional child into a required mutation argument. Add fixtures proving the mutation remains directly callable without the argument while the command is not.

### MATERIAL — D1: the React hook cannot own the refresh lifecycle as written

**Section:** D1, “React/Expo projection.”

**Defect:** LLP 0210 says the hook owns the refresh loop and projection cache. Accepted LLP 0044 says asset renderers are projections over the framework-neutral asset client/live store, “not a React-specific transport, cache, or auth model.” LLP 0114 likewise assigns timers and mutable lifecycle to framework-neutral external stores; hooks subscribe to them, and authority replacement synchronously blanks the old generation (`llp/0044-asset-storage-pipeline.rfc.md` §Client upload surface; `llp/0114-first-class-react-and-query-groups.spec.md` §§Context, identity, and authority; External-store composition and cleanup).

A hook-owned issuance timer therefore contradicts the governing projection architecture and leaves non-React consumers without the accepted refresh model.

**Suggested resolution:** Keep `signedUrl()` pure and uncached, but introduce an explicit framework-neutral issued-URL store/controller that owns the URL, expiry timer, refresh, authority partition, and diagnostic state. `useSnapbackAssetUrl` and the existing renderer should only project that store. Register the hook under LLP 0114’s named projections. Acceptance should prove authority A→B synchronous blanking, fencing of late issuance responses, final-unmount timer cleanup, and same-key subscriber sharing.

### MATERIAL — D1: the hook state algebra does not represent its promised failures

**Section:** D1, hook return shape and denial behavior.

**Defect:** The shown return value contains only `{ url, status }`, but the text promises a structured diagnostic on refusal. It also distinguishes authorization refusal from neither transient issuance failure nor expiry after refresh becomes unreachable. Treating transport failure as `denied` would falsely report loss of authority; retaining an expired URL as `ready` would be equally misleading.

**Suggested resolution:** Define the complete state/result algebra, including `diagnostic` and a distinct retryable/unavailable state. Specify whether the last URL remains renderable only until its actual `expiresAt`, and what happens when refresh fails before versus after expiry. Pin those transitions in fixtures.

### MATERIAL — D2: variant enumeration lacks authorization precedence

**Section:** D2, unknown-variant refusal.

**Defect:** Enumerating an asset intent’s variant keys requires asset-specific metadata. LLP 0044 requires metadata visibility and signed issuance to follow the asset’s read policy and says possession of an asset id is not metadata authority (`llp/0044-asset-storage-pipeline.rfc.md` §§Asset read authorization; Authorization). D2 does not require authorization before returning its enumerating refusal, so an implementation could distinguish assets or reveal their variant sets to unauthorized probes.

**Suggested resolution:** Parse generically, authorize the asset and issuance, and only then validate/enumerate variant keys. Unauthorized callers must receive the ordinary access denial without variant details. Add negative fixtures for unauthorized existing/nonexistent assets combined with an unknown variant.

### MATERIAL — D3: the raw asset-task settlement contract remains unowned and incomplete

**Section:** D3, “task.done legibility.”

**Defect:** D3 attributes the settlement rule to LLP 0180’s terminal-state transitions, but LLP 0180 governs `CommandTask.done`, which resolves to `CommandOutcome` with `succeeded/failed/cancelled/ambiguous`; it does not define the raw `AssetTask` returned by `assets.start()` (`llp/0180-asset-bearing-client-commands.rfc.md` §§Command task; Terminal-state transitions). LLP 0044 describes asset lifecycle states but does not provide a closed raw-task `done` status/outcome table. The pilot consequently guarded both `ready` and `finalized` and then separately checked `failed`/`rejected` (`pilot-record/posts.tsx`).

“Ready is the only success” is a useful ruling, but “rejects each non-ready terminal” is not executable until the complete terminal vocabulary and the status of `finalized` are frozen.

**Suggested resolution:** Define the raw `AssetTask.done` contract in D3 or its owning LLP: every terminal status, its settlement value, whether `finalized` remains a state/alias, and diagnostic availability. Then define `upload()` mechanically over that table and test every row. Add `upload()` and the exact `task.done` sentence to the cross-cutting guide obligations, not only the prose in D3.

### MATERIAL — D5: grant authorization and edge identity are underspecified

**Section:** D5(b).

**Defect:** “Owner as granter” answers who may create an edge but not which asset policies such an edge may override. Accepted LLP 0044 says `owner-only` denies every non-owner, while `via-references` grants access through declared reference edges (`llp/0044-asset-storage-pipeline.rfc.md` §Asset read authorization). If `ctx.assets.grant()` works on an `owner-only` asset, it creates a new read-authority path and contradicts the claim that rung (b) widens no authority. If it works only under a grant-enabled or `via-references` policy, the RFC must say so.

The pair-shaped `revoke(assetId, principal)` is also unsafe under overlapping reasons for access. LLP 0044’s existing model authorizes when at least one qualifying reference edge remains. A pair-wide revoke could erase an independent grant created for another conversation, message, or workflow. The pilot’s row-based composition avoided this because each row was an independently removable authority edge (`pilot-record/diary.md` §§M4–M5; `issues/20260809-asset-recipient-grant-authority-g4.md`).

**Suggested resolution:** Specify:

- which declared read policies admit grant edges;
- authorization for both grant and revoke;
- stable edge identity/provenance, such as a returned `grantId` or caller-supplied idempotent grant key;
- revoke-one-edge semantics, preserving access while another edge remains;
- commit/invalidation/audit behavior.

Acceptance must cover unauthorized grant/revoke, duplicate/idempotent grants, two independent grants followed by one revoke, strict denial after the final revoke, and the signed-URL TTL window.

### DETAIL — Evidence excerpt does not contain the claimed issuance struct

**Section:** Evidence / D2.

`packages-excerpts/assets-rs-signed-url-request.txt` contains `AssetAttemptCreateRequestV1` and part of `AssetTusInstructionV1`, not `AssetSignedUrlIssueRequestV1`. The pilot record still establishes the empty-body 422, so this does not invalidate D2’s decision, but the claimed ground-truth excerpt should be replaced before acceptance.

### DETAIL — Guide and acceptance lists omit part of D3’s closure

**Section:** Guide obligations; Acceptance.

The issue’s completion condition includes discovery of `assets.upload()` and `task.done` at the call site, but the cross-cutting guide list omits both and D3 acceptance checks only runtime behavior (`issues/20260809-asset-upload-dx-papercuts-g11.md` §Done when). Add a CI-verified guide snippet and capability-index update for the helper and raw-task settlement table.

### DETAIL — Status metadata disagrees

**Section:** Header and Status.

The header says `Review`, while the final Status section says `Draft`. Align the prose with the author-authorized Review transition; this review proposes no status change.

## Explicit answers

- **Does D4’s required-over-optional rationale hold?** No. The mapping is semantically safe, and a command narrowing a more general mutation is coherent. Admission is the better ruling.
- **Is D5’s rung ordering right?** Yes: recipe now, grant operations as the paved spelling, app-bound sharing deferred is the right sequencing for the evidence. Rung (b)’s policy compatibility, revoke authority, and independent-edge identity must be decided before the RFC is ready.
- **Does D1’s no-client-cache decision hold?** Yes for `signedUrl()` itself. Explicit issuance should remain pure and uncached.
- **Does D1’s projection-owned-refresh decision hold?** Not if the React hook owns mutable lifecycle. Refresh should be owned by an explicit framework-neutral store/controller, with React and renderers acting as projections.

## Recommended next step

Revise D1 around a framework-neutral refresh store and complete state algebra; admit D4’s safe mapping; freeze the raw asset-task terminal table; and close D5’s policy and grant-identity semantics. Then rerun review with acceptance fixtures updated for those decisions.

VERDICT: NOT READY
## Round 2 (delta round) — 2026-08-09

- Reviewer: Codex CLI `gpt-5.6-sol`, `model_reasoning_effort=xhigh`,
  read-only sandbox rooted at the r2 capsule; mutually blind; no
  round-1 knowledge.
- Target revision r2 sha256:
  `b2acd19612ce69514143a7e1568bb4e66bb7868f3793090574b9cffe4b73f9d6`
- Capsule sha256:
  `43830f12a58647d700c798abc4b90518c96602107e315f57e68bd6ffc273184b`
- Instructions sha256:
  `a8f82bfea5b6bcb9f402a1dc8f71486fae4fb1c5ec2d5e55ff4e67bbed2dd90d`
- Received: complete, well-formed. Verdict: **NOT READY**
  (5 MATERIAL, all IN-DELTA; 1 DETAIL IN-DELTA; explicitly no
  PRE-EXISTING MATERIAL).

### Review body (verbatim)

## Delta assessment

The r2 direction largely coheres with the accepted context: D2 closes the enumeration leak, D3 adopts the shipped terminal vocabulary, D4 correctly treats the command as a safe narrowing, and D5 introduces appropriate edge identity and lifecycle. The controller and grant concepts are also directionally right. However, several IN-DELTA lifecycle and authorization invariants remain underspecified enough to permit unsafe or incompatible implementations.

## Concerns

1. **MATERIAL — IN-DELTA — D1 state algebra and authorization changes.** The public union has five states, but `issuing` has no normative definition or transitions. More importantly, retry stops in `denied`, yet authorization can be gained without changing authority identity—most directly when D5’s principal activates a pending grant—so a controller denied before `open()` can remain parked after the caller becomes authorized. Define a complete transition table, including `issuing`, retries from `unavailable`, and a same-authority authorization-invalidation signal that drives `denied → issuing → ready`; fixture pending-grant denial → activation → ready and ready → revocation → denied. Accepted asset authorization already treats permission dependencies as live invalidation inputs in [LLP 0044 §Asset read authorization](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/llp/0044-asset-storage-pipeline.rfc.md:604).

2. **MATERIAL — IN-DELTA — D1 final-unsubscribe cleanup.** Cancelling only the timer does not fence an issuance already in flight; its late response can republish or schedule another timer after demand reaches zero. That is weaker than the invoked LLP 0114 discipline, which requires synchronous generation invalidation, disposal of late handles, and eventual registry eviction on final unsubscribe ([LLP 0114 §External-store composition and cleanup](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/llp/0114-first-class-react-and-query-groups.spec.md:672)). Require last-unsubscribe fencing or abort, forbid late publication/timer creation, define entry eviction or linger, and add an unsubscribe-before-issuance-resolution fixture proving zero residual work.

3. **MATERIAL — IN-DELTA — D3 terminal settlement versus retry.** D3 retains retry on `assets.start()` while making `.done` settle at the first terminal status, but never states whether retry reopens that task or returns a successor task. The shipped surface exposes `retry()` and the terminal list is exactly `ready | rejected | cancelled | failed` ([client excerpt](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/packages-excerpts/asset-client-custody-excerpt.txt:21)); Accepted LLP 0044 also requires retry to create a successor upload attempt for the same asset ([LLP 0044 §Client upload surface](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/llp/0044-asset-storage-pipeline.rfc.md:354)). Freeze terminal task snapshots and specify that any admitted retry returns a new `AssetTask`/generation with independent `.done` and the same asset ID; add a per-terminal retry-eligibility table and predecessor/successor settlement fixtures.

4. **MATERIAL — IN-DELTA — D5(b) mutation atomicity.** The RFC does not say that mint, activate, and revoke are staged in the calling mutation and commit atomically with related app-row writes, nor that their authorization and state preconditions are revalidated under the final write lock. Without this, an aborted `send()` could leave an active grant, an aborted `open()` could activate access, or `close()` could commit while revocation loses a race. LLP 0044 explicitly provides transaction-scoped admission, final-lock revalidation, and same-transaction system-edge updates for attachment to avoid this class of defect ([LLP 0044 §Typed references and atomic attachment](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/llp/0044-asset-storage-pipeline.rfc.md:947)). Apply equivalent commit-bound semantics to every grant transition and fixture rollback, retry/idempotency, activate-versus-owner-revoke, and revoke-versus-issuance races.

5. **MATERIAL — IN-DELTA — D5(b) no-ambient-widening claim.** `grants: true` is described only as a property of “the upload intent”; the RFC does not require the opt-in to be captured in the asset’s immutable policy generation. Looking up the current declaration after a redeploy could retroactively make older assets grantable, contradicting the claim that no existing asset gains an authority path. Accepted LLP 0044 freezes intent policy at asset creation/finalization ([LLP 0044 §Generated upload intents](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/llp/0044-asset-storage-pipeline.rfc.md:257)). State that grant eligibility is an immutable per-asset/frozen-generation fact, define effective read authority as the existing policy OR an active eligible grant, and fixture an asset created before opt-in refusing mint after redeployment unless explicitly migrated.

6. **DETAIL — IN-DELTA — D5(b) pending grants and reference GC.** Pending grants deliberately do not protect an asset, while reference GC reclaims ready assets lacking protective edges ([LLP 0044 §Deletion, retention, and garbage collection](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/llp/0044-asset-storage-pipeline.rfc.md:1335)). The view-once recipe should therefore require a typed reverse reference or another declared retention basis throughout the pending window and fixture activation after the GC grace boundary.

I found no PRE-EXISTING MATERIAL concern.

## Explicit answers

**(a) D5(b):** The closed authorization rules are conceptually sound: only the owner originates edges, principal-only activation expresses acceptance, and `grantId` makes revoke-one-edge semantics precise. The pending → active → revoked sequence can express view-once, but the machine is not sound enough as written without commit atomicity, same-authority client invalidation, and immutable per-asset opt-in. Its no-viewer-originated-authority claim is honest; its broader no-ambient-widening claim is conditional on adding the frozen-generation rule.

**(b) D4:** Yes. Required child → optional mutation argument is safe narrowing: generation requires the command input and always supplies it while direct mutation callers retain the optional branch. The inverse remains unsafe and is correctly refused; this matches the input-derivation model and the accepted context’s observation that the admitted direction is semantically satisfiable ([LLP 0180 §Declaration](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r2/llp/0180-asset-bearing-client-commands.rfc.md:204)).

**(c) D1:** No. The keyed, authority-partitioned shared loop is the correct owner, but the missing `issuing` semantics, absent same-authority recovery from `denied`, and incomplete final-unsubscribe fencing prevent a complete fixture matrix.

VERDICT: NOT READY
## Round 3 (focused delta round) — 2026-08-09

- Reviewer: Codex CLI `gpt-5.6-sol`, `model_reasoning_effort=xhigh`,
  read-only sandbox rooted at the r3 capsule; mutually blind; no
  prior-round knowledge.
- Target revision r3 sha256:
  `21e33e4b87982317f06fc6f2a9436a2914f9bcb5a7781c8cfe1dcb3dd37e3d96`
- Capsule sha256:
  `aa6bc1e1f6979272c4fb64e54663468b038b0a8511280803cb8b055326b16469`
- Instructions sha256:
  `62852c1533e7af60e34bd5f0a519d01a0ea61776671e231eae14fb78a4d98e8a`
- Received: complete, well-formed. Verdict: **NOT READY**
  (2 MATERIAL, both IN-DELTA; 2 DETAIL IN-DELTA; explicitly no
  PRE-EXISTING MATERIAL).

### Review body (verbatim)

## Delta assessment

r3 substantially improves the design: D3 now matches the accepted successor-attempt lifecycle, and D5’s owner-mint, frozen-policy, and commit-time checks form a coherent no-ambient-widening model. It is not ready, however, because D1’s claimed total fixture matrix remains incomplete and D5 introduces a mandatory grant-count ceiling without an acceptance oracle.

## Concerns

- **MATERIAL — IN-DELTA — §D1 state algebra and fixture matrix.** Authority replacement or logout synchronously blanks an old entry, but that reachable snapshot maps to none of the five states: it is not `ready`, has no issuance required for `issuing`/`refreshing`, has no non-authorization failure required for `unavailable`, and cannot be `denied` because that state requires a structured authorization refusal. This conflicts with “every reachable condition maps to exactly one state” in [LLP 0210 §D1](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r3/llp/0210-asset-upload-dx-closure.rfc.md:135); LLP 0114 instead explicitly specifies an empty/pending authority handoff before the successor snapshot ([LLP 0114 §Context, identity, and authority](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r3/llp/0114-first-class-react-and-query-groups.spec.md:252)). Additionally, D1 names three exits from `denied`, but Acceptance explicitly tests only `refresh()`; it does not pin fresh-subscription or composed invalidation-signal recovery. The unsubscribe fixture proves “zero residual work” but does not explicitly prove registry-entry eviction. Resolve by defining the authority-handoff snapshot or terminal disposal in the five-state model, then add fixtures for each denied-exit trigger, exact A→B/logout status transitions, entry absence after final unsubscribe, and fresh-generation behavior on resubscription.

- **MATERIAL — IN-DELTA — §D5(b) grant-count quotas.** The design correctly names per-app/per-principal grant-count ceilings, but D5 Acceptance contains no quota fixture or refusal behavior ([LLP 0210 §Acceptance](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r3/llp/0210-asset-upload-dx-closure.rfc.md:439)). This leaves the new durable, per-recipient record class without proof of the bounded-state rule required by LLP 0044, which requires ceilings for every durable record class and per-principal limits where principals can mint records ([LLP 0044 §Deduplication, keys, and quotas](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r3/llp/0044-asset-storage-pipeline.rfc.md:860)). Resolve by defining which principal dimension is charged, counting both pending and active edges, checking the ceiling atomically with mint, releasing the live-edge count atomically on revoke, and adding limit, over-limit, concurrent-mint, and revoke-then-remint fixtures with a typed quota refusal.

- **DETAIL — IN-DELTA — §D5(b) frozen-generation and race wording.** “At creation/finalization” is unnecessarily ambiguous; LLP 0044 says each asset records the generation under which it was admitted and finalizes under that same frozen policy ([LLP 0044 §Internal model](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r3/llp/0044-asset-storage-pipeline.rfc.md:451)). Replace it with “captured at asset admission/creation; finalization and later grant operations read that stored generation.” Also give the revoke-versus-issuance fixture a precise oracle: revoke-first must deny issuance; issuance-first may return a TTL-bounded URL; no execution may authorize from a stale post-revoke edge.

- **DETAIL — IN-DELTA — §D3 ineligible `retry()` result.** The semantics correctly prohibit successors for `ready` and `rejected`, but the API text first says terminal `retry()` yields a successor and then says those rows are “never” eligible. State explicitly that these calls refuse with a typed not-retryable diagnostic and create no successor. This is consistent with LLP 0044’s rule that only pending assets admit successor attempts ([LLP 0044 §Client upload surface](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r3/llp/0044-asset-storage-pipeline.rfc.md:354)).

No PRE-EXISTING MATERIAL concern was identified.

## Explicit answers

**(a) Do the denied-exit and unsubscribe-fence rules complete D1’s fixture matrix?** No. Only the explicit-`refresh()` denied exit is pinned; fresh subscription and composed invalidation are not. Entry eviction is also not asserted directly, and authority replacement/logout lacks a valid state mapping.

**(b) Are retry-successor semantics consistent with LLP 0044 §Client upload surface?** Yes. They preserve the asset id, require the underlying asset to remain pending-eligible, leave the predecessor settled, and give the successor an independent generation and `.done`. The shipped terminal set is indeed `ready | rejected | cancelled | failed` ([client ground-truth excerpt](/private/tmp/claude-501/-Users-ccheever-projects-snapback/94eb0fa7-610e-4b8f-8ad9-e56c319904a7/scratchpad/0210-capsule-r3/packages-excerpts/asset-client-custody-excerpt.txt:102)); only the ineligible-call result needs editorial clarification.

**(c) Do frozen-generation opt-in and commit atomicity make D5(b)’s no-ambient-widening claim and probes sound?** Substantively yes: admission-time frozen opt-in prevents redeploy from widening old assets, owner-only mint prevents viewer-originated authority, final-lock revalidation prevents aborted or stale transitions, and the sole-authority `owner-only` composition makes 403/200/403 meaningful. The frozen-generation wording and race oracle should be tightened, while the omitted quota acceptance remains a separate material readiness failure.

VERDICT: NOT READY