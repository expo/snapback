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

## Round 2 (delta round) — 2026-08-09

- Reviewer: fresh Claude subagent (model `claude-fable-5`), mutually
  blind, capsule-only, no round-1 knowledge.
- Target revision r2 sha256:
  `b2acd19612ce69514143a7e1568bb4e66bb7868f3793090574b9cffe4b73f9d6`
- Capsule sha256:
  `43830f12a58647d700c798abc4b90518c96602107e315f57e68bd6ffc273184b`
- Instructions sha256:
  `a8f82bfea5b6bcb9f402a1dc8f71486fae4fb1c5ec2d5e55ff4e67bbed2dd90d`
- Received: complete, well-formed. Verdict: **READY** (0 MATERIAL;
  7 DETAIL — 6 in-delta, 1 pre-existing).

### Review body (verbatim)

# Review — LLP 0210 (Asset upload and delivery DX closure), super-refine round 2 (delta round)

Reviewer: Claude family, mutually blind, round 2. Worked solely from the review capsule. Target: `llp/0210-asset-upload-dx-closure.rfc.md` at r2.

## Delta assessment

The r2 decisions cohere with the document and the accepted context: the issued-URL controller lands refresh exactly where LLP 0044's "projections over the framework-neutral asset client and live store" rule and LLP 0114's external-store discipline demand it, the frozen D3 terminal table matches the shipped client's ground truth verbatim (`TERMINAL = ['ready', 'rejected', 'cancelled', 'failed']`, `packages-excerpts/asset-client-custody-excerpt.txt`), and the D4 flip and D5(b) grant machine both resolve their commissioning dated notes (LLP 0180 2026-08-09; LLP 0044 §Clique-pilot delivery and grant DX closure item 4) in the direction the pilot evidence actually supports. The revision's factual claims check out against the capsule's primary evidence — the hand-rolled issuance fetch and 30-second cache (`pilot-record/data.ts`), the defensive nonexistent-`finalized` branch (`pilot-record/posts.tsx` line 129), the required `variant: String` field (`packages-excerpts/assets-rs-signed-url-request.txt`), and the 403/200/403 view-once probes (run-log M4/M5, scores B5). I find no MATERIAL concern, in the delta or in pre-existing text; the remaining findings are precision details.

## Concerns

**1. DETAIL / IN-DELTA — §D1 (state algebra): `issuing` is the one state without a normative definition, and one reachable condition has no assigned state.** The normative bullet list defines `ready`, `refreshing`, `unavailable`, and `denied` but never `issuing`. Consequently the condition "held URL has expired and a re-issuance is in flight but has not yet failed" is unassigned: it is not `refreshing` (requires a still-valid held URL), not `unavailable` (requires that re-issuance "is failing"), and `issuing` is undefined. Since the algebra is declared normative with "fixtures pin each transition," this is exactly the seam a fixture author will trip on. Resolution: add one definition line — `issuing` = issuance in flight with no valid held URL (both the initial issuance and the post-expiry re-issuance case) — so every reachable condition maps to exactly one state.

**2. DETAIL / IN-DELTA — §D1 + OQ4: no defined exit from `denied` short of authority replacement.** OQ4 pins that retry continues in `unavailable` and stops in `denied`, and authority replacement blanks entries — but a server-side re-grant under the *same* authority (a D5 grant re-activated, a viewer re-added to a chat) leaves the entry parked in `denied` with no specified recovery. Resolution: pin the re-entry path in the fixtures (e.g., a fresh subscribe on the same key attempts one new issuance, or an explicit refresh affordance on the controller); one sentence in D1 or OQ4 suffices.

**3. DETAIL / IN-DELTA — §D5(b): revoke's effect on the grant record is unspecified.** The lifecycle union is closed at `pending | active` and revoke is "one edge, by identity," but the text never says whether revoke deletes the record or moves it to a terminal state. This matters for fixtures (what does a second `revoke(grantId)` or an `activate` after revoke refuse with?), for the provenance/audit story the system-record framing promises, and for the reference-GC obligation (which names `active` and `pending` but not revoked residue). Resolution: state it — e.g., revoke removes the edge and the lifecycle receipt is the durable audit evidence — so the "two independent grants survive one revoke" acceptance row is unambiguous about post-revoke observability.

**4. DETAIL / IN-DELTA — §D5(b): grant records are a new durable, principal-mintable record class; the named G4 obligations omit LLP 0044's bounded-counts obligation.** LLP 0044 §Deduplication/quotas requires per-app and per-principal ceilings on every durable record class precisely so no workload grows state without a declared limit; per-recipient minting at send is exactly such a workload (N grants per message). The blanket 0044 rule arguably governs automatically, but the RFC enumerates three named obligations for the dated 0044 amendment and this fourth one is the same kind. Resolution: add the count-ceiling/quota line to the G4 obligation list.

**5. DETAIL / IN-DELTA — §D5(b): the view-once composition constraint is implicit.** The 403-before-open guarantee holds only when the grant edge is the *sole* authority path — i.e., the intent's declared read policy must not independently admit the recipient (a `via-references` intent whose asset is referenced from a recipient-visible message row would grant read regardless of the pending grant). The design is sound (`grants: true` on an `owner-only` intent gives exactly the pilot's semantics), but the constraint is never stated. Resolution: one sentence in (b) or an explicit note that the guide recipe pins the composition (owner-only + `grants: true` for view-once).

**6. DETAIL / IN-DELTA — §D1 (controller keying): "partitioned by the prepared binding's authority identity" is binding-flavored wording for a framework-neutral store.** OQ1's resolution says non-React consumers use the controller directly, including external-bearer custody with no prepared binding. The shipped neutral idiom already exists — `taskStoreKey` partitions by app (base URL) + authority identity (`packages-excerpts/asset-client-custody-excerpt.txt`, line 55–58). Resolution: word the partition as "the same app and authority identity as the persisted task facts," which covers both custody modes and matches the shipped client.

**7. DETAIL / PRE-EXISTING — §D5(a): the recipe's post-(b) fate is unstated.** (a) blesses the transfer-at-open field-patch idiom as a CI-verified recipe while (b) exists specifically to retire that idiom; the document says the recipe is "the supported path until [(b)] ships" but not what happens to the published recipe page afterward. Resolution: note that on (b)'s landing the recipe page gains the grant-ops spelling as primary with the row-composition kept as the portable fallback (or is superseded outright) — guide-obligation bookkeeping, one line.

No MATERIAL concerns found, in-delta or pre-existing.

## Answers to the three decision questions

**(a) Is the D5(b) grant machine sound, and honest in its no-ambient-widening claim?** Yes. The authorization rules are genuinely closed: mint requires caller = owner (the same rule `attach` already enforces per the G4 ticket's `SNAPBACK_ASSET_FORBIDDEN` evidence), activate requires caller = the grant's principal on a `pending` edge, revoke requires owner or principal. Every `active` edge therefore traces to an owner mint by construction — activation only converts owner-minted latent authority and revocation only narrows, so "a viewer can accept and relinquish authority the owner minted, never originate it" is an accurate statement, and the intent-level `grants: true` opt-in plus untouched `owner-only`/`via-references` policies makes "no new authority path on any existing asset" true as well. View-once is fully expressible with no field-patch idiom — mint-pending at send confers nothing (403), self-activate at open (200), self-revoke at close (403) — reproducing the pilot's hostile-probe sequence exactly (run-log M4/M5, scores B5). Revoke-by-`grantId` gives genuine one-edge independence. The soundness gaps that remain are the details above (revoked-record fate, ceilings, the sole-authority composition constraint), none of which undermines the machine's decisions.

**(b) Is D4's admission ruling correct as specified?** Yes. Admitting the required-child → optional-argument mapping is the right call and correctly reasoned: a command is a narrower generated entry point over a more general mutation, and narrowing at the client boundary leaves the mutation's contract untouched — other callers keep the text-only branch, and the document is properly honest that descriptor requiredness is a generation/client-side authoring guarantee, never a server contract the handler may rely on. This is what the pilot actually wanted and approximated with a weaker contract (`optional: true` + handler validation, run-log M4). The inverse (optional child over required argument) is genuinely unsafe — the text-only branch would invoke a mutation missing a required input — and keeping it refused while teaching both fixes at the point of denial matches LLP 0180's existing refusal table and the LLP 0193 refusals-as-docs posture. The fixture pair (mutation callable without the argument; command not) pins the asymmetry correctly, and the descriptor shape stays unchanged as LLP 0180's dated note requires.

**(c) Is the D1 controller + state algebra complete enough to fixture?** Substantially yes, with the two definitional gaps in concerns 1 and 2. The controller's obligations are concretely fixturable as written: keyed sharing (one loop for N consumers), refresh-before-expiry, synchronous authority blanking with generation-fencing of late responses, final-unsubscribe timer cleanup — each has a matching acceptance row. The five-state union with `denied` reserved for structured authorization refusals is the right decomposition, and the stated negatives (transient failure ≠ `denied`; failed refresh does not leave `ready` while the URL is valid; offline lands in `unavailable`) pin the discriminating transitions. What a fixture author still cannot derive from the text is the normative meaning of `issuing`, the state assignment for expired-URL-with-in-flight-reissuance, and the exit from `denied` after a same-authority re-grant. All three are one-line definitional fixes, not design changes, so they do not make the item unfixturable — but they should land before the fixtures do.

## Verdict

The r2 delta resolves its round-1 commissions coherently against LLP 0044, 0180, 0114, 0012, and the pilot record's ground truth; every factual platform claim I could check against the capsule's primary evidence held. The remaining concerns are precision details that identify no defective decision, and under the altitude rule they are not grounds for NOT READY.

VERDICT: READY

## Round 3 (focused delta round) — 2026-08-09

- Reviewer: fresh Claude subagent (model `claude-fable-5`), mutually
  blind, capsule-only, no prior-round knowledge.
- Target revision r3 sha256:
  `21e33e4b87982317f06fc6f2a9436a2914f9bcb5a7781c8cfe1dcb3dd37e3d96`
- Capsule sha256:
  `aa6bc1e1f6979272c4fb64e54663468b038b0a8511280803cb8b055326b16469`
- Instructions sha256:
  `62852c1533e7af60e34bd5f0a519d01a0ea61776671e231eae14fb78a4d98e8a`
- Received: complete, well-formed. Verdict: **READY** (0 MATERIAL;
  5 DETAIL, all IN-DELTA; explicitly no PRE-EXISTING MATERIAL).

### Review body (verbatim)

# LLP 0210 — super-refine round 3 review (focused delta, fresh reviewer)

**Target:** `llp/0210-asset-upload-dx-closure.rfc.md`, r3.
**Scope:** the r3 delta (§D1 `issuing`/`denied`-exit/unsubscribe-fence/keying, §D3 frozen snapshots + retry successor, §D5(b) frozen-generation opt-in + commit atomicity + revoke-removes-edge + sole-authority/GC/quota constraints, §Acceptance extensions), with the rest of the document treated as prior-round text.

## Delta assessment

The r3 delta closes the round-2 holes cleanly and, importantly, closes them in the platform's own idioms rather than inventing new ones: the `denied`-exit and unsubscribe-fence rules are LLP 0114's generation-fence discipline applied to the issued-URL controller; the retry-successor rule is LLP 0044 §Client upload surface's successor-attempt rule (and LLP 0180's already-reviewed settle-at-terminal/retry-returns-successor pattern) restated over the shipped `TERMINAL` set; and the frozen-generation `grants: true` capture reuses LLP 0044's existing per-intent policy-generation fencing instead of adding a second opt-in mechanism. Every delta rule arrives with a corresponding acceptance fixture, and I verified the delta's factual anchors against the capsule ground truth (the `TERMINAL` list and `taskStoreKey` partition in `packages-excerpts/asset-client-custody-excerpt.txt`, the `AssetSignedUrlIssueRequestV1` struct, and the pilot's `uploadPicked`/`signedAssetUrl` code). I found no MATERIAL concern in the delta and no MATERIAL concern in pre-existing text; the remaining findings are detail-grade tightenings.

## Concerns

**C1 — DETAIL, IN-DELTA (§D1, final-unsubscribe fence).** The new sentence "the entry is evicted once fenced" can be read as immediate synchronous eviction at final unsubscribe, which would bypass the linger LLP 0114's own discipline prescribes ("Same-identity idle stores remain available through a single queued-microtask linger … so React Strict Mode cleanup/replay reattaches without creating parallel demand" — `llp/0114-first-class-react-and-query-groups.spec.md` §External-store composition and cleanup). Immediate eviction would be *correct* (no residual work, no stale publish) but would make every Strict Mode unmount/remount cycle abandon and restart an issuance — mildly against the same resubscribe-storm lesson D1 cites. The text does cite "LLP 0114's final-unsubscribe discipline," so the intended reading is probably fence-synchronously-then-evict-per-0114. **Resolution:** one clause — "evicted per LLP 0114's linger/eviction discipline" — so the fence is synchronous and the eviction timing is explicitly 0114's, not a new rule.

**C2 — DETAIL, IN-DELTA (§D1 / §Acceptance, `denied`-exit coverage).** The delta names three exits from `denied` (fresh subscription, explicit `refresh()`, composed authorization-invalidation signal), but the acceptance row pins only the `refresh()` loop and its inverse. The fresh-subscription exit is the one a plain component remount exercises — it deserves its own fixture; the composed-signal exit is correctly hedged as conditional ("when the controller composes with the asset-record live store"), which matters because a *denied* viewer may hold no live asset-metadata subscription for LLP 0053's machinery to invalidate on a grant activation, so the signal cannot be the guaranteed exit — and the text rightly does not make it one. **Resolution:** add a fresh-subscription-exit fixture to the D1 acceptance row; optionally add one sentence noting `refresh()`/fresh-subscription are the guaranteed exits and the composed signal is best-effort.

**C3 — DETAIL, IN-DELTA (§D3, frozen-terminal-snapshot scope).** "A settled task never mutates" is the right rule for the retry-successor semantics it anchors, but read maximally it collides with LLP 0044 §Client upload surface, where the task snapshot exposes "trusted asset availability and ready rendition metadata" — facts that keep changing after `ready` as optional renditions publish. The freeze should be explicitly scoped: the settled snapshot and `.done` value are frozen; post-settlement asset/rendition observation belongs to the live store and renderer surface, not the settled task. **Resolution:** one scoping sentence (or a parenthetical pointing at the live lifecycle channel).

**C4 — DETAIL, IN-DELTA (§D5(b), migration escape without an owner).** "an asset created before the opt-in refuses mint after a redeploy **unless explicitly migrated**" names an escape hatch with no named mechanism or owner — nothing in the acceptance rows, the four G4 obligations, or the G4 ticket (`issues/20260809-asset-recipient-grant-authority-g4.md`) carries a migration op. The refusal itself is the load-bearing (and fixture-pinned) behavior, so the design is sound either way. **Resolution:** either route the migration op to the G4 ticket by name (it is generation-migration/operator-action shaped work LLP 0044 already has vocabulary for) or strike the clause and let migration be a future ruling.

**C5 — DETAIL, IN-DELTA (§D3, ineligible-retry refusal shape).** The per-terminal eligibility rows say `ready`/`rejected` retry is "never" admitted and `failed`/`cancelled` retry is "refused otherwise," but the refusal's surface shape is unspecified — LLP 0180 solved the identical seam with the distinguished `notRetryable` outcome precisely because surfacing it as an ordinary failure recreates the "failed, safe to resend" conflation. The asset task's `.done` model (settle with the terminal snapshot) differs from `CommandTask`'s, so the answer need not be identical, but it should be named. **Resolution:** state that ineligible `retry()` refuses with a typed structured diagnostic (registry-reconciled spelling, same pattern as OQ2) rather than a bare error, and pin it in the eligibility fixtures.

None of these identifies a defective decision; all are wording/coverage tightenings on decisions that are themselves correct. Under the altitude rule none is grounds for NOT READY.

**Pre-existing text:** no MATERIAL concerns found. The prior-round D1/D2/D4 and D5-authorization text checked out against the capsule ground truth everywhere I probed it (the `variant: String` required field in `packages-excerpts/assets-rs-signed-url-request.txt` matches D2's premise; the `widthPx`-supersedes rule matches the struct's doc comment; the pilot's hand-rolled cache and absolute-URL resolution in `pilot-record/data.ts` match D1's motivating claims; the D4 refusal story matches LLP 0180's 2026-08-09 dated note).

## Answers to the three decision questions

**(a) Do the r3 `denied`-exit and unsubscribe-fence rules complete D1's fixture matrix? Yes.** The five states are now individually defined, mutually exclusive, and jointly cover every reachable condition I could construct (in-flight/no-URL → `issuing`; valid URL held → `ready` or `refreshing`; no valid URL + non-auth failure → `unavailable` with retry re-entering `issuing`; structured authorization refusal → `denied` with immediate blank). `denied` is no longer a terminal trap — the exit paths make authorization-return expressible, and the acceptance row pins the full loop in both directions (pending-grant denial → activation → `refresh()` → `ready`, and `ready` → revocation → `denied`), which is exactly the D5-composition round trip the design needs. The unsubscribe fence ("a late response neither publishes nor schedules further work," entry evicted, zero-residual-work fixture) is LLP 0114's bounded-generation rule applied correctly, and the controller keying now matches the shipped persistence partition (`taskStoreKey` = base URL + authority identity, `packages-excerpts/asset-client-custody-excerpt.txt`). Residual gaps are C1/C2, both detail-grade.

**(b) Are the retry-successor semantics consistent with LLP 0044 §Client upload surface? Yes.** LLP 0044 states `retry()` "creates a successor upload attempt for the **same asset id** while the pending asset remains eligible," that "retry is always a successor attempt," never a reopened terminal one, and that "a `ready`, `rejected`, or `deleted` asset admits no further upload attempts." D3's per-terminal rows are a faithful projection of that onto the shipped client terminal set (`ready | rejected | cancelled | failed`, `asset-client-custody-excerpt.txt` line 165): `ready` never (published assets admit no attempts), `rejected` never (durably rejected, matching 0044's permanent-policy-refusal row), `failed`/`cancelled` eligible exactly while the asset remains `pending`-eligible — which is 0044's lifecycle table verbatim (attempt `expired`/`cancelled`/`failed` leaves the asset `pending` and retry-eligible unless permanently refused). The frozen-predecessor/independent-successor-`.done` shape mirrors the settle-at-terminal rule LLP 0180 §Terminal-state transitions already fought through two review rounds to get right, and `upload()` never retrying keeps the convenience mechanical over the frozen table. The pilot's defensive `finalized` branch (`pilot-record/posts.tsx` line 129) is exactly the illegibility the frozen table retires.

**(c) Do the frozen-generation opt-in and commit-atomicity rules make D5(b)'s no-ambient-widening claim and probe fixtures sound? Yes.** The opt-in capture reuses LLP 0044 §Internal model's existing machinery — each asset records the intent policy generation it was admitted under, and generations are frozen at admission — so `grants: true` cannot reach pre-opt-in assets retroactively, and the acceptance row (pre-opt-in asset refuses mint after redeploy) is the right probe for exactly the ambient-widening hole a mutable opt-in would open. Commit atomicity mirrors LLP 0044 §Typed references and atomic attachment (staged in-transaction, preconditions revalidated under the final write lock), which is the established pattern for authority-bearing writes racing revocation; the named race fixtures (activate-vs-owner-revoke, revoke-vs-issuance, aborted-mutation rollback, idempotent re-run) cover the seams that matter. The closed authorization rules make the no-ambient-widening statement literally checkable — every `active` edge traces to an owner mint because mint is owner-only, activate is principal-only-from-`pending`, and revoke removes the edge with receipts as the durable evidence. The two composition constraints the delta adds are the load-bearing ones for the 403/200/403 fixture: sole-authority (`grants: true` + `owner-only`, since a sharing-declared `via-references` edge would admit the viewer pre-open) and pending-window retention (pending edges deliberately do not protect against reference GC, so the typed `assetRef` reverse reference carries retention — consistent with LLP 0044 §Deletion, where only typed edges protect, and correctly fixture-pinned via activation-after-grace-boundary). The one loose thread is the unowned "explicitly migrated" clause (C4), which does not weaken the claim — the refusal is the default and is fixture-pinned.

VERDICT: READY
