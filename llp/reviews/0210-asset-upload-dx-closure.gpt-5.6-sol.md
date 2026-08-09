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