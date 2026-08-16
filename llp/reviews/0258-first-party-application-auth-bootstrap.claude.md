# Review artifact: LLP 0258 — claude family

Target: `llp/0258-first-party-application-auth-bootstrap.rfc.md`

## Round 1 — 2026-08-15

- **Reviewer:** Claude (Fable 5), fresh general-purpose agent, blind.
- **Revision under review (r1):** sha256
  `fbea549187d56e9dcd82a42485d4a1be4202ed76f3832e6f753237576c3b7362`
  (landed commit `4cc971ea4`).
- **Capsule:** APFS clone of `git archive 4cc971ea4` export, no 0258 review
  artifacts or run journal present (structural blindness).
- **Instructions:** sha256
  `b730742554df966819f527c877bb4b12be01c86218d3777d4f68abb848c373eb`.
- **Verdict:** NOT READY.

### Review body (verbatim)

## Review: LLP 0258 — First-party application auth bootstrap (round 1)

**Summary.** This RFC proposes the right thing: the corpus genuinely lacks a composition owner over the session protocol (LLP 0057/0227), custody/barrier protocol (LLP 0059/0053), public lifecycle (LLP 0238), and Expo binding/supervision (LLP 0181), and I verified the claimed gap against code — the Expo provider today adopts a supervisor-minted bearer per boot with no durable custody (`packages/snapback-expo/provider.mjs`, `supervised-environment.mjs`), the only native durable custody story is a guide-taught application adapter whose "ownership" is an in-memory promise queue around `expo-secure-store` (`guide/backend/familiar-profile.md` §Persist native session custody), and the browser IndexedDB + Web Locks adapter exists exactly as described (`packages/snapback-contract/auth-custody-indexeddb.mjs`). The ownership boundaries claimed against 0059 (§Client custody and `AuthCoordinator`), 0227 (adoption split at lines 251–265), 0238 D6, 0252 D1, 0064 §7, and 0096 (native `auth/sender` nonclaim, line 630) all check out as protocol citations, and the document is honest about the native-carrier open question rather than hand-waving it. However, three defects block acceptance as written: the D4 facade's signup signature silently discards LLP 0227's one-time recovery codes while claiming to change no result contract; D2's three-part owner key (app id, partition, binding target) is incoherent against 0059's two-part coordinator identity and against D2's own no-silent-sharing sentence; and D5's supervised-adoption precedence conditions on a policy admission that D1's closed schema cannot express.

### Concerns

1. **MATERIAL (D4, correctness/decision quality).** The facade declares `signUpWithPassword(input: PasswordSignupInput): Promise<void>`. But `client.authPasswordSignup` returns `AuthRecoveryCredentialPublicProjectionV1`, whose doc comment reads "One-time recovery custody returned only by signup/consume/rotate" and which carries `recoveryCodes` (`packages/snapback-client/index.d.mts:524–535`); Diary 0076 confirms the product reality ("Signup returned eight codes"). A `void` return on the ordinary path makes the user's only chance to see recovery custody unreachable — an application on the first-party path cannot render recovery codes at all without dropping back to the advanced client. This directly contradicts D4's own sentence "The methods are conveniences over existing client methods, not new routes or result contracts": eliding the recovery projection *is* a new result contract, and a worse one. The fix is small (return the non-secret recovery/credential projection, or an explicit decision that recovery codes move elsewhere), but the signature as written is a defective decision, and "names remain subject to API review" (D2) does not cover return-payload semantics.

2. **MATERIAL (D2 vs Constraints vs LLP 0059, coherence).** D2 keys the bootstrap owner by "canonical app id, storage partition, and binding target" and then "obtains or constructs the single logical `AuthCoordinator` for that key." LLP 0059 §Client custody fixes coordinator identity at exactly (canonical app id, storage partition): "Each JavaScript/native execution context returns exactly one local `AuthCoordinator` for each canonical Snapback app id and storage partition" — and the RFC's own Constraints section repeats that two-part identity. For two binding targets over the same app id and partition, the two readings diverge: if the coordinator is keyed by the three-part bootstrap key, one context holds two coordinators over one custody record, violating 0059 and the RFC's first constraint; if it is keyed two-part, the two bootstrap owners share durable authority across targets, which D2's closing sentence ("A different binding target or storage partition is a different explicit key and cannot silently share authority") forbids. The only consistent resolutions — refuse a second target for an already-claimed (app id, partition), or derive per-target default partitions — are not stated. Since D2's singleton/keying semantics are the heart of this RFC and are frozen in Phase 0.2, this must be closed in the text, not at implementation.

3. **MATERIAL (D1 vs D5, coherence).** D5.3 admits a supervised-development bootstrap "when the generated policy admits the development entry," but `ApplicationAuthBootstrapV1`'s closed `entryMechanisms` union (D1) contains only `password-v1`, `email-code-v1`, and `external-session-explicit-v1` — no member expresses supervised development entry. The Terminology section makes "supervised development bootstrap" a distinct authority source from "advanced external adoption" (D5.4 makes external adoption advanced-surface-only and non-competing), so `external-session-explicit-v1` cannot silently be the supervised admission bit without contradicting D5.4; nothing else in the policy can be it. As written, the schema that Phase 0.2 freezes cannot express the precedence condition D5 normatively depends on. Either the policy needs a development-entry fact (with its release-artifact implications addressed — 0181 prunes supervised vocabulary from release exports), or D5.3's condition must be re-anchored on something that exists (e.g. the `source: "supervised-dev"` binding admission of LLP 0181), and the RFC must say which.

4. **minor (D2, "existing `client.auth` namespace").** The `client.auth` namespace is specified by LLP 0238 D6 (`client.auth.currentPrincipal()` etc., Accepted) but is not yet implemented — the shipped client exposes flat `authPasswordSignup`/`authSession`/etc. methods and no `auth` property (verified across `packages/snapback-client/index.d.mts` and `index.mjs`). Calling it "existing" overstates; the RFC should state plainly that D4/D6 depend on 0238 D6's not-yet-built projection, since that is a real sequencing dependency for Phase 1.

5. **minor (Related / Motivation, citation integrity).** The header cites Diary 0079 and Diary 0083 and the Motivation leans on "The Clique 0.1.21 Explicit lane" / "The Familiar lane" findings, but no diary numbered above 0077 exists in this revision's corpus (`diaries/`). The claims are indirectly corroborated (the guide's SecureStore section and Diaries 0071/0076 evidence the composition burden), so the motivation stands, but the cited artifacts must exist in the revision that gets accepted or the citations corrected.

6. **minor (D7 vs LLP 0181, ownership of the boot-state union).** D7's `AuthBootstrapSnapshot` adds a `custody` stage and a `blocked` status to what is today LLP 0181's closed `ExpoBootState` union (0181 §Provider: stages `binding | authority | client`; statuses without `blocked`). Phase 0.3 promises cross-reference amendments "without changing their underlying protocols," but extending a closed public state union is a protocol change to 0181's surface. Say explicitly who owns the boot-state union after 0258 and that 0181's union is being extended, not merely referenced.

7. **minor (D4/D5, authenticated-predecessor entry).** LLP 0227 requires an anonymous coordinator for signup/signin/reset adoption ("adopt as anonymous issuance … which requires an anonymous coordinator", 0227:255–260). D4's refusal list ("loading, refreshing, clearing, blocked, or incompatible") never names the settled-*authenticated* predecessor case, yet Acceptance exercises "user switch." State that `signInWithPassword` against an authenticated principal refuses with a typed diagnostic directing explicit `signOut` (or define a composed switch), rather than leaving it under the vague "incompatible."

8. **minor (Constraints vs D2, bearer-setter claim).** "No bearer setter exists on the ordinary API," yet `SnapbackAppClient.client` exposes the full `SnapbackClient`, which carries `setBearerToken`/`replaceBearerToken`. In practice these are already custody-fenced ("cannot bypass browser or agent custody," `packages/snapback-client/index.mjs:3050–3078`), so there is no security hole, but the constraint should be restated as "the exposed client's bearer-replacement surface refuses under bootstrap custody" rather than implying absence.

9. **minor (header hygiene).** LLP 0077 is load-bearing in Scope and D8 (sender-constrained custody nonclaim) but absent from the Related list.

### Implementation-phase notes (recorded, not blocking under the altitude rule)

- D2's reference counting does not specify drop-to-zero behavior (immediate vs deferred teardown) across Strict Mode's mount→unmount→remount 1→0→1 sequence; acceptance covers remount stress, but the chosen semantics should be written down when frozen.
- D6's ordinary web path presumes an "admitted browser binding"; the provenance/minting of a browser `AppBinding` (vite dev vs release artifact) is unspecified.
- `SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE` and `SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT` are new codes and will need diagnostics-registry and D9 manifest rows.
- Open question 3's conservative recommendation (initialize the durable anonymous partition first) should be promoted to normative text at Phase 0 freeze; leaving it as a recommendation invites divergent Phase 1 behavior.
- Open question 1 is correctly self-gated ("must be resolved before acceptance") and Phase 0.1 names the probe; I verified the guide adapter it disqualifies is indeed process-local. This is the right open question, honestly held; it does not itself count against the document, but acceptance must not occur before the probe answers it.

The central decision — one composition owner over unchanged protocols, with capability-gated custody and closed precedence — is right, the alternatives are fairly dispatched, and the security posture (D8) is appropriately modest. The three MATERIAL findings are all repairable in a revision without redesign.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-15

- **Reviewer:** Claude (Fable 5), fresh general-purpose agent, blind.
- **Revision under review (r2):** sha256
  `840995cbb6e87582ca7c2fc035362da6ea11a466d85bef577af6f759900dae4a`.
- **Capsule:** round-1-lineage clone with r2 overlaid (no 0258 review
  artifacts present).
- **Instructions (delta round):** sha256
  `53306c45d9ad62ac153fec0c84b81d1e88b6ab0e2432b8e9f382e8f2ca224778`.
- **Verdict:** READY. Per the author's standing instruction for this loop,
  the claude family is dropped from subsequent rounds after this READY.

### Review body (verbatim)

I have now verified the document and its delta claims against the corpus (LLP 0059, 0181, 0227, 0238, 0241, 0247, 0252, 0253, 0064, 0077, 0096) and the shipped code (`packages/snapback-client`, `packages/snapback-expo`, `packages/snapback-contract`, `packages/snapback-codegen`, guide pages). Here is the review.

---

# Review: LLP 0258 r2 — First-party application auth bootstrap (delta round)

## Summary

Revision r2 is a substantial and well-grounded improvement, and the delta text survives verification against the corpus and the shipped code. The load-bearing r2 claims check out: the owner key now matches LLP 0059's coordinator identity exactly (one coordinator per canonical app id + storage partition, 0059 §Client custody, line ~1658); the rewritten D2 construction order is compatible with 0059's real participant model (constructor-time transport participant registration exists at `packages/snapback-client/index.mjs:2742`, final confirmation closes the participant set, and 0059's late-registration/catch-up rules are correctly invoked rather than contradicted); `authPasswordSignup` really does return `Promise<AuthRecoveryCredentialPublicProjectionV1>` today and `authPasswordChange` exists (guide reference `expo-snapback-client.md:5498-5515`), so D4's exact-result-contract rule is anchored in shipped fact rather than aspiration; the "specified, not shipped" characterization of `client.auth`/`useSnapbackCurrentPrincipal` is accurate (neither exists in the shipped client or React/Expo packages; LLP 0238 D6 specifies both); the D3 dismissal of the guide's SecureStore recipe as a process-local queue is accurate (`guide/backend/familiar-profile.md` — an in-process `ownershipTails` map with read-then-write CAS, no cross-process fencing); the per-generation `clientStoreId` claim matches `packages/snapback-expo/supervised-environment.mjs` (`snapback-expo-${supervisorGeneration}`); the D5/Phase 0 amendments to 0181 are honestly declared as real protocol changes, and they need to be — today's supervised environment adopts via `createExternalSessionClient`/`replaceBearerToken` on `refreshAuthority`, exactly the behavior the amendment removes from the ordinary path; the LLP 0253 S6.1 amendment claim is correct (S6.1's export list is closed and contains no auth hooks); the new diagnostic codes collide with nothing in the capsule; and `replaceBearerToken`'s refusal under coordinator custody is real (`index.mjs:3071`). The remaining concerns are clarity and citation issues, none of which identifies a defective decision.

## Concerns

1. **minor / IN-DELTA — "Authority key" terminology collides with LLP 0059's existing `authorityKey`.** (Terminology; D2.) LLP 0059 already uses `authorityKey`/`CanonicalAuthorityKey` (`AuthorityCaptureV1`, 0059 line ~1680) for the per-authority digest over `{appId, kind, authMode, authorizationStreamIncarnation, sessionId, userId}` — a value that changes on every authority transition. 0258 now uses "authority key" for the stable pair (canonical app id, storage partition). The RFC's own definition is careful ("It is exactly LLP 0059's coordinator and custody identity"), and the concept is correct, but two adjacent normative documents now use the same term for two different identities, one stable and one transition-rotating. A distinguishing name (e.g. "custody key" or "owner key") or an explicit disambiguation sentence would prevent a real implementer confusion. Does not identify a defective decision.

2. **minor / IN-DELTA — D1's derivation enumeration does not cover `custody`.** D1 states codegen "derives every `ApplicationAuthBootstrapV1` field" from the normalized `defineAuth`/schema program, then enumerates derivations for `mode`, `entryMechanisms`, and `anonymousPublic` only. Today's `defineAuth` program (`packages/snapback-codegen/define.mjs`) has no custody axis, so `custody: "durable-required" | "volatile-explicit"` requires extending the authored program — itself a semantic-identity change under LLP 0241 that D1 does not name. The later text ("must be written explicitly", "both authoring profiles spell or default these facts through their existing front ends") implies this, so the decision — one derived projection, no second configuration — is sound; the derivation source of `custody` should simply be stated. Implementation-phase material.

3. **minor / IN-DELTA — D2's remint-rebind and the binding-conflict refusal need one clarifying sentence.** D2 says a supervisor generation remint "rebinds transport facts on the same owner," while "constructing for an authority key that a live owner already holds with a different binding target" refuses with `SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT`. A supervisor remint *is* a different binding target arriving while the owner is live, so these two sentences can be read as assigning both outcomes to the same event. The evident reconciliation is that remint flows through the live owner's own supervised-refresh/rebind path (0181's provider, amended in Phase 0), whereas the refusal governs *fresh construction* against a live key — but the surface that performs the owner-level rebind is never named, and the Expo provider as described in D6 "delegates to the common application-client constructor," which after a remint would present the new binding to the constructor. Worst case is a spurious fail-closed refusal, not a safety hole, and the intent is discernible; one sentence naming the rebind path would close it. Does not identify a defective decision.

4. **minor / IN-DELTA — recovery-credential provenance is cited to LLP 0227, which deferred recovery codes.** D4 and D8 attribute the one-time recovery-credential projection to LLP 0227, but 0227 explicitly leaves recovery codes to LLP 0151 ("Preissued recovery codes stay with the 0151 lifecycle spec," 0227 line ~349). The normative claim — preserve the shipped `authPasswordSignup` result contract exactly — is verified true against the shipped client declaration, so nothing behavioral is wrong; the LLP citation for the recovery-code lifecycle should point at 0151 (or at the shipped surface) rather than 0227. Citation precision only.

5. **minor / IN-DELTA — where the 0238 D6 namespace lands is left slightly ambiguous.** LLP 0238 D6 specifies `client.auth.currentPrincipal()` on the client itself; 0258 D2 says Phase 1 "delivers the 0238 D6 projection as part of the bootstrap owner," and the facade lives at `appClient.auth`. Whether the low-level `SnapbackClient` also gains the `auth` namespace (0238's literal spelling) or only the app-client facade carries it is not pinned. Since D9's generated mechanism→method rows and 0238's own manifest will force this to be settled once, this is implementation-phase sequencing, not a design defect.

6. **minor / PRE-EXISTING — the Node/headless custody row is underspecified relative to the other rows.** D3's matrix gives Node/headless "explicit file/transactional adapter where admitted" with no design selected, while the browser and native rows now name concrete carriers. This is consistent with the RFC's phasing (no phase gates on headless custody) and is recorded as detail work, not a defective decision.

## Implementation-phase notes

- The D3 native module should record the OS storage-domain constraints its whole-record rule meets (Keychain item size vs. a serialized `AuthCustodyV2`; Android's secure storage being encryption-at-rest via Keystore-wrapped keys rather than Keystore-resident data). The record is small, so this is evidence work for the Phase 0 probes, not a design risk.
- The single-runtime declaration needs a concrete detection/refusal story per platform (iOS extensions, Android multi-process manifests) — correctly deferred to the Phase 0 probes by OQ1.
- Migration of records written by the guide's application SecureStore adapter into the first-party module falls under the Compatibility section's "explicit validated adapter/translation" rule; the guide page (`guide/backend/familiar-profile.md` §Persist native session custody) should be updated in Phase 2 so new applications stop minting the unqualified format.
- D7's `authority-required` versus `blocked` boundary ("genuinely unsettleable" per D5) will need a per-diagnostic table in the D9 rows so the two states cannot drift apart across arms.
- Diary 0079/0083 citations are pending a concurrent landing per the known disposition; not treated as a defect.

## Verdict rationale

Every delta claim I could test against the corpus and shipped code verified: the 0059 key/participant/late-registration alignment, the shipped signup/change result contracts, the not-yet-shipped status of the 0238 D6 surface, the process-local nature of the guide's SecureStore recipe, the per-generation `clientStoreId`, the current `replaceBearerToken`-based supervised refresh that the declared 0181 amendment replaces, the closed 0253 S6.1 export list, and the section anchors into 0252 D1, 0064 §7, and 0059. The r2 revisions are honest about which surfaces they amend (0181's boot union and supervised adoption; 0253's export list) versus which they merely reference (0059, 0227, 0238, 0252). All remaining concerns are terminology, citation, or clarity items that identify no defective decision and are recordable as implementation-phase material.

VERDICT: READY
