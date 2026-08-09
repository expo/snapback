# Review artifact — LLP 0210 (asset upload DX closure) — family: claude

## Round 1 — 2026-08-09

- Reviewer: fresh Claude subagent (model `claude-fable-5`), mutually
  blind, capsule-only.
- Target revision sha256:
  `5e3d310b165777bbdc8d50de3ba216f12e8f985fc99e30c55b1025b3447da1d7`
- Capsule sha256:
  `590864da49af5471408c81716c459e0622b2e60cffd565c6dbd4fd3791b5b3c6`
- Instructions sha256:
  `64e8fd22e6e6899bdf655ed9754ac9100f7afb93ea1c1551e8d0cc9a1fb1689b`
- Received: complete, well-formed. Verdict: **NOT READY** (2 MATERIAL).
- Reviewer's own blindness attestation: did not read the sibling
  reviewer's run log beyond identifying it (`codex-r1-log.txt` was
  present in the capsule directory from the codex launch — orchestrator
  note: exclude launch logs from the capsule directory in later rounds).

### Review body (verbatim)

# Review — LLP 0210: Asset upload and delivery DX closure (super-refine round 1)

**Reviewer:** Claude (Fable 5), capsule `0210-capsule-r1`, working blind of the sibling review.

## Summary of what the document decides

LLP 0210 converts the Clique pilot's B5 = 62/100 asset-surface record (`pilot-record/scores.md`, `pilot-record/run-log.md` M4/M5, `pilot-record/diary.md`) into five rulings: **D1** adds `assets.signedUrl()` to the framework-neutral client (pure authorized issuance, no silent client cache) plus a React `useSnapbackAssetUrl` hook that owns TTL refresh, with the DTO/custody obligations folded into the LLP 0012 headless contract; **D2** makes the issuance body's `variant` optional (default `primary`, `widthPx` still superseding), with typed refusals replacing bare framework 422s; **D3** adds a one-call `assets.upload()` convenience with a settle-or-reject contract over `assets.start()`, plus a one-sentence `task.done` legibility obligation; **D4** makes `SNAPBACK_COMMAND_ASSET_MAPPING_INCOMPATIBLE` teach the `optional: true` escape and rules the required-child → optional-argument pairing stays refused, with the rationale on the refusal; **D5** resolves LLP 0044's open authority ladder as: (a) bless the pilot's grant-rows recipe now, (b) adopt `ctx.assets.grant`/`ctx.assets.revoke` as the paved spelling (implementation under the G4 ticket), (c) defer app-bound `assetSharing` to the LLP 0208 G4 membership program. Acceptance of the RFC constitutes the author ruling LLP 0044's 2026-08-09 dated addition left open.

D1–D3 are faithful, well-evidenced closures of gaps the accepted LLP 0044 already owes ("the generated client refreshes it before expiry" — `llp/0044-asset-storage-pipeline.rfc.md` §Delivery profiles, §Client upload surface). The evidence section is accurate against the pilot record in every particular I checked (hand-rolled POST + protocol header and hand-built 30 s cache: `pilot-record/data.ts`; empty-body 422: `pilot-record/run-log.md` M4; the `uploadPicked` status maze: `pilot-record/posts.tsx`; the 403/200/403 grant composition: `pilot-record/run-log.md` M5, `pilot-record/scores.md` B5). One item does not survive adversarial reading: D5(b)'s v1 semantics contradict D5(b)'s own headline outcome.

## Concerns

### C1 — MATERIAL — §D5(b): the v1 owner-as-granter rule makes the promised view-once outcome (grant-at-open / revoke-at-close) unreachable

**Defect.** D5(b) states a grant is "created only by a handler whose caller the asset's intent policy admits as a granter (v1: the owner — the same rule `attach` enforces today, so (b) widens no authority)," and §Non-goals reinforces it: "Anonymous or viewer-minted grants — (b) keeps the owner-as-granter rule." The same paragraph then claims "View-once becomes grant-at-open / revoke-at-close with no field-patch idiom," and §Acceptance requires the ops to "reproduce the pilot's hostile-probe sequence (403 before open, 200 during, 403 after close)."

These cannot both be true. `open()` is invoked by the **viewer**, not the owner — that is exactly why `ctx.assets.attach`'s owner-only rule "sank the 'viewer mints their own view-once grant' design" in the pilot (`pilot-record/run-log.md` M5: `SNAPBACK_ASSET_FORBIDDEN`) and forced the field-patch workaround in the first place. Under owner-as-granter, `ctx.assets.grant(assetId, viewer)` inside a viewer-called `open()` mutation refuses for the identical reason; `ctx.assets.revoke` inside a viewer-called `close()` has the same problem. Pre-granting at send restores the wrong probe result (200 before open). So (b) v1 as specified is *strictly less expressive than the recipe (a) it is advertised to pave*: the recipe expresses view-once (viewer-called mutations transfer authority via ordinary app-row writes the sharing predicate reads); the paved ops cannot. The flagship acceptance fixture is unsatisfiable as written.

**Suggested resolution** (any one, recorded explicitly): (i) narrow (b) v1's claims to the send-time/delete-time grant flows (chat attachments, delete-for-everyone) and state that view-once stays on recipe (a) until OQ3's granter-widening rules — correcting the view-once sentence, the non-goal framing, and the acceptance fixture; or (ii) define grant admission relative to the intent policy's declared granter *rules* rather than bare caller-is-owner, and admit a caller-relative rule sufficient for view-once (e.g. "a principal holding a declared pending grant may activate it for itself" / grantee-self-revoke) as part of v1, honestly recording that this widens authority beyond `attach`; or (iii) shift the trust boundary to declared handler identity (the app names which mutations are granting mutations), which is what the field-patch recipe de facto does today. Whichever way, the current text's "widens no authority" + "view-once becomes grant-at-open" pairing must not survive into the accepted ruling.

### C2 — MATERIAL — §D1 (React/Expo projection): the closed status union conflates transient issuance failure with authoritative denial

**Defect.** The hook's status set is `'issuing' | 'ready' | 'refreshing' | 'denied'`, and the only stated failure transition is "drops to `denied` with the structured diagnostic when issuance refuses." There is no state for the two non-denial failure shapes the pilot record makes prominent: a transient/connectivity issuance failure (this app class is explicitly offline-exercised — `pilot-record/diary.md` M6) and an expired URL that cannot currently be re-issued for non-authorization reasons. As ruled, an app following the RFC's own guidance ("apps render the denial state instead of a broken `<img>`") will render access-revoked UI on a network blip. This is precisely the truthfulness distinction this platform treats as load-bearing elsewhere: LLP 0180 restructured `CommandOutcome` so `ambiguous` can never masquerade as `failed` (`llp/0180-asset-bearing-client-commands.rfc.md` §Command task), and LLP 0114's presence hook keeps `error` and stale-retention distinct (`llp/0114-first-class-react-and-query-groups.spec.md` §Presence hook). Since §Acceptance pins "denial-state fixtures," the defective union will be frozen by fixtures if accepted as-is.

**Suggested resolution.** Either add a distinct variant (`'error'`/`'stale'`) carrying the non-refusal diagnostic while bounded retry continues (the LLP 0114 idiom), or state normatively that `denied` is entered **only** on a structured authorization refusal and that all other failures retain `'refreshing'` (with the last diagnostic exposed) — and add the corresponding negative fixture (transient failure ≠ denied) to §Acceptance.

### C3 — DETAIL — §D4.2: the rationale's first clause is wrong-shaped, and it is about to be pinned verbatim into fixtures

The ruling (keep refusing; teach both fixes) is sound, but the drafted rationale leans on "the declared contracts would disagree about whether absence is a representable state." A caller narrowing an optional parameter to always-present is ordinary contract narrowing, not a disagreement — reviewers and future readers will pick this apart. The load-bearing argument is the one the clause's tail gestures at: descriptor-level requiredness is **unenforceable at the commit boundary** (every other caller of the mutation keeps the absence branch open, so the handler can never rely on it), and a client-only guarantee dressed as a contract is what the server-authoritative posture forbids. Since §Acceptance D4 pins "its rationale sentence" in codegen fixtures, tighten the sentence to the enforceability argument before pinning. Also note the listed fixes assume one command per mutation; for the dedicated-asset-command-over-shared-mutation shape (e.g. `sendPhoto` over a general `sendMessage`), "make the argument required" breaks the other callers and "make the child optional" loses the per-command presence check — the diagnostic (or the guide section) should name the third fix: split the mutation.

### C4 — DETAIL — §D1: the hook's store/identity semantics and its governance seat are unstated

Two omissions, both implementation-adjacent but worth one sentence each: (1) whether equivalent mounts of `useSnapbackAssetUrl(assetId, opts)` under one provider share one issuance/refresh loop (LLP 0114's "equal identities share one store" discipline; without it, a chat screen rendering the same asset N times issues N URLs on N timers — the resubscribe-storm lesson of `pilot-record/run-log.md` M3 argues for saying it now); (2) where the hook's authority is recorded — LLP 0114 §Named projections is an explicit amendment ledger and LLP 0180 took care to state its own 0114 amendment, while 0210's §Status names dated amendments only for 0044/0180. Either state that asset hooks ride LLP 0044 §Client upload surface's existing React-projection authority (the `useSnapbackAssetImage` precedent), or add the 0114 ledger entry to the acceptance plan.

### C5 — DETAIL — §D5(b): invalidation, storage locus, and GC interactions of grant edges are unnamed

LLP 0044 makes every read-authority source carry its LLP 0053 invalidation projection and dependency capture (§Asset read authorization), and grant edges are a third authority source beside `owner-only` and `via-references` — effectively extending a closed set the Accepted document defines. D5(b) states the delivery consequences (strict denies next request; signed stops issuance) but not: the 0053 projection obligations for grant edges (live metadata blanking on revoke), whether grant edges are system records or app rows, and how a grant-only asset (no typed reference) interacts with reference GC ("only typed reverse-reference edges protect"). Name these as G4-ticket obligations in the RFC so the dated 0044 amendment can record them.

### C6 — DETAIL — §D3: two `done` vocabularies; and the settle sentence should be checked against the real task contract

The one-sentence rule "resolves at the first terminal status; `ready` is the only success" is stated for the asset task while the sibling command task's `done` resolves `CommandOutcome.kind: 'committed'` (`llp/0180-asset-bearing-client-commands.rfc.md`). The docs obligation should explicitly disambiguate the two `done`s. Also, the pilot's defensive code checked `'finalized'` as a possible success status (`pilot-record/posts.tsx`) — before pinning "ready is the only success," verify the shipped task snapshot vocabulary actually has no `finalized`-shaped success alias, or the taught sentence will itself mis-teach.

### C7 — DETAIL — §Status (trailer): contradicts the header

The header says **Status: Review** (with the Draft → Review transition recorded in Revised); the trailing §Status section still opens "Draft." Fix the trailer.

### C8 — DETAIL — capsule evidence hygiene: the named ground-truth excerpt does not contain the issuance struct

`packages-excerpts/assets-rs-signed-url-request.txt` holds `AssetAttemptCreateRequestV1` and `AssetTusInstructionV1`, not `AssetSignedUrlIssueRequestV1` — so the capsule's direct ground truth for "`variant` is required today" is only the pilot's observed 422 (`pilot-record/run-log.md` M4) and the G11 ticket's citation of `src/assets.rs:1140`. The pilot evidence is sufficient for this review; note for the orchestrator that the excerpt should be corrected for later rounds. (The excerpt is still useful: it shows the sibling DTOs' `deny_unknown_fields` + `#[serde(default)]` optional-field idiom D2 will reuse.)

## Answers to the three decision questions

**Does D4's required-over-optional rationale hold?** The *ruling* holds: refusing the pairing is right because descriptor-level requiredness cannot be enforced at the commit boundary while the mutation's contract admits absence from other callers — a client-only guarantee masquerading as a contract, contrary to the platform's server-authoritative posture — and the teach-with-reason resolution matches both the refusals-as-docs standard (LLP 0193) and LLP 0180's dated note. But the *drafted rationale sentence* does not hold as written: "the declared contracts would disagree" mischaracterizes ordinary caller-side narrowing (C3). Tighten it to the enforceability argument before the fixture pins it.

**Is D5's rung ordering right given the evidence?** Yes. (a)-now is owed regardless and is the pilot-proven composition; (b)-as-paved-spelling is the design-correct replacement for authority-transfer-by-field-write; deferring (c) so asset sharing and the G4 roster projection evolve together is the right coupling (`llp/0208-clique-pilot-gap-closure.plan.md` G4). The ordering is not the problem — the *content of (b)'s v1 rule* is (C1): as specified it cannot express the view-once flow that motivates it, making (b) narrower than the recipe it paves. Repair (b)'s scope or granter semantics; keep the ladder.

**Do D1's no-client-cache and projection-owned-refresh decisions hold?** Yes, both. A silent cache in the neutral client would make revocation-latency reasoning depend on client internals, and returning `expiresAt` gives every caller exactly what a cache needs; putting refresh in the projection layer matches the LLP 0114 projection discipline and the accepted LLP 0044 promise that the *renderer level* owns refresh. OQ1 (opt-in neutral-client cache for non-React consumers) is the right question to leave open. Two caveats, neither overturning the decisions: the hook needs a non-denial failure state (C2, gating) and stated identity-sharing semantics (C4).

## Verdict

Two unresolved MATERIAL concerns: D5(b)'s internal contradiction (C1) and D1's denial-conflating status union (C2). Both are repairable with bounded edits; everything else is implementation-phase material.

VERDICT: NOT READY
