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
