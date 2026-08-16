# Review artifact: LLP 0258 — codex family

Target: `llp/0258-first-party-application-auth-bootstrap.rfc.md`

## Round 1 — 2026-08-15

- **Reviewer:** codex exec, model gpt-5.6-sol, reasoning effort xhigh,
  read-only sandbox, blind.
- **Revision under review (r1):** sha256
  `fbea549187d56e9dcd82a42485d4a1be4202ed76f3832e6f753237576c3b7362`
  (landed commit `4cc971ea4`).
- **Capsule:** APFS clone of `git archive 4cc971ea4` export, no 0258 review
  artifacts or run journal present (structural blindness).
- **Instructions:** sha256
  `b730742554df966819f527c877bb4b12be01c86218d3777d4f68abb848c373eb`.
- **Verdict:** NOT READY.

### Review body (verbatim)

The central decision is sound: a first-party composition owner over the existing `AuthCoordinator`, custody, client, and provider is preferable to another auth system. The RFC correctly preserves LLP 0059’s barrier, rejects silent memory fallback, and retains LLP 0181’s honest supervised-channel threat posture. Code inspection confirms the browser coordinator/custody and password adoption paths are substantial and reusable. However, the RFC is not ready for acceptance: one blocker is explicitly acknowledged, and several ownership and public-contract details remain contradictory or incomplete.

1. **MATERIAL — The native durable carrier is still an unresolved acceptance prerequisite.** D3 and Open question 1 explicitly say the carrier must be selected before acceptance. This is substantive, not implementation detail: the guide’s SecureStore adapter provides only process-local serialization, while LLP 0059 §Cross-context ownership requires fenced ownership or transactional CAS, and LLP 0064 §7 requires separate iOS and Android evidence. The RFC must choose and specify either the native primitive/module or the exact single-runtime profile, including background/multi-process refusal, storage format and migration ownership, before becoming Accepted.

2. **MATERIAL — The bootstrap-owner key and durable-custody key are not coherent.** Constraints and LLP 0059 §Client custody and `AuthCoordinator` require exactly one coordinator per canonical app id and storage partition. D2 instead keys the owner by app id, partition, **and binding target**, while promising that different targets cannot share authority. The existing LLP 0059 record and browser adapter are keyed only by canonical app id (`AuthCustodyV2`; `packages/snapback-contract/auth-custody-indexeddb.mjs`, `readCustody`/`replaceCustody`). Meanwhile, `AppBinding.target` contains generation-bearing `schema` and `functions` identities plus origin/routing (`packages/snapback-expo/app-binding.mjs`), and LLP 0181 §Supervised development baseline remints it after compatible graph changes. If the complete target keys the singleton, ordinary generation/HMR churn can create another coordinator, contradicting D2’s Fast Refresh guarantee. If it does not key durable storage, different owner keys can silently read the same bearer record, contradicting D2’s target isolation. The RFC must define a stable authority-partition key, state exactly which binding/deployment facts enter it, and specify how custody storage is partitioned or target-bound. If that changes LLP 0059’s app-id-only record/key, Phase 0 cannot claim this requires no underlying protocol amendment.

3. **MATERIAL — D2’s normative construction order cannot satisfy the existing participant barrier as written.** D2 step 5 registers the client store, connection owner, live resources, outbox, and provider before step 7 constructs the client. In current code, the `SnapbackClient` constructor itself creates and registers the mandatory transport participant (`packages/snapback-client/index.mjs`, `__authTransportParticipant`), while the React registry registers its participant only when that owner is created (`packages/snapback-react/implementation.mjs`, `createRegistry`). LLP 0059 §Participant contract and §Readiness facts require these participants before final exposure. The RFC should normatively order construction as: create paused client/owners, register all then-existing mandatory participants, synchronize/handshake, close the final participant set under confirmation, then expose the projection. Dynamically created live resources can register afterward under LLP 0059’s late-registration rules; they cannot literally be registered before they exist.

4. **MATERIAL — D1 does not close its relationship to the existing auth-program authority.** Current code already has one normalized auth declaration: `defineSchema(..., {auth:{mode}})` and `defineAuth({mechanisms, providers, guestPolicy, ...})` in `packages/snapback-codegen/define.mjs`. D1 adds another `mode` and mechanism allowlist but does not say whether these fields are derived from that program, must be a checked subset, or may independently disagree. Binding-capability intersection alone does not prove that the application’s admitted provider/program supports the mechanism. The ambiguity is especially visible for password variants/recovery and for `external-session-explicit-v1`, which D5 assigns exclusively to the advanced constructor. LLP 0252 D1 requires every canonical auth field to have one explicit adapter disposition. D1 must pin the source-of-truth mapping and refusal rules so this policy cannot become a second auth configuration.

5. **MATERIAL — D4 does not preserve the existing password result contract or complete mechanism surface.** The RFC says the facade creates no new result contracts, but declares signup/signin as `Promise<void>`. The shipped `authPasswordSignup` returns `AuthRecoveryCredentialPublicProjectionV1`, including one-time recovery codes (`packages/snapback-client/index.d.mts`, `AuthRecoveryCredentialPublicProjectionV1` and `authPasswordSignup`; implementation at `packages/snapback-client/index.mjs` §password issuance). Silently discarding that result destroys required credential custody. The facade also omits password change, set, reset, recovery, and refresh even though current client methods expose them and Acceptance requires password change and refresh to share the lifecycle. Finally, there is no existing `client.auth` property in the current client declaration; LLP 0238 D6 specifies that future namespace, but D2 incorrectly describes it as already existing. D4/D9 must give an exact method-and-return mapping, including one-time recovery-secret handling, and reconcile D8/Acceptance’s broad “no credential payload in public state” language with the legitimate one-time recovery-code return.

6. **MATERIAL — D5’s supervised-conflict state has no executable resolution path.** D5 blocks boot in `authority-required` while offering “keep current,” “sign out and adopt,” or “select another partition.” D7 exposes only diagnostic/remediation data. On the current Expo ownership shape, non-ready children are withheld and the fallback receives only the boot snapshot (`packages/snapback-expo/provider.mjs`, `SnapbackExpoProvider`); it has no coordinator or auth action with which to sign out or confirm the current principal. The proposed `SnapbackAppClient` likewise requires a `client`, although the conflict prevents public readiness. Thus the ordinary path can reach a state whose required explicit transition cannot be initiated through its specified API. The RFC must expose owner-controlled conflict-resolution operations with exact stale/race behavior, or allow durable authority to become ready while treating the ambient supervisor mismatch as a non-authoritative diagnostic.

7. **MATERIAL — Open question 3 leaves a security- and capability-relevant runtime behavior undecided.** Constraints say missing durable custody is a pre-I/O refusal, D3 limits the refusal wording to protected resources and credential entry, and Acceptance requires refusal before public `ready`. Open question 3 then asks whether anonymous public work may proceed without custody. This determines whether the owner may open transport/resources before establishing its future protected storage owner; it is not merely constructor naming. The conservative recommendation is coherent, but it must be promoted into D1–D3 before acceptance.

8. **minor — Custody facts are assigned to two incompatible inspection owners.** D1 says volatile custody appears in “bootstrap/current-principal inspection,” while Constraints, D6, and D7 keep `currentPrincipal` as LLP 0238’s unchanged closed auth projection and put custody facts in bootstrap state. Remove the current-principal claim or explicitly amend LLP 0238; the apparent intended design is already the cleaner bootstrap-only projection.

Implementation-phase notes:

- Make singleton creation single-flight and reload-stable, including pending construction, failure eviction, zero-to-one reacquisition during Strict Mode cleanup, and final-reference disposal.
- On final disposal, order React/provider disposal, `client.closeAuth()`, coordinator close, and adapter close so no participant or storage connection is retired while another projection still owns it.
- Exercise supervised-token comparison without first adopting the token, plus races among explicit sign-in, conflict resolution, logout, supervisor refresh, and partition changes.
- Treat native process exclusion as a proved capability predicate, not an assumption derived from React Native’s usual execution model.
- Scan bearer material and one-time recovery material under distinct rules: neither may persist in diagnostics/artifacts, but recovery codes require one deliberate application return boundary.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-15

- **Reviewer:** codex exec, model gpt-5.6-sol, reasoning effort xhigh, read-only sandbox, blind.
- **Revision under review (r2):** sha256
  `840995cbb6e87582ca7c2fc035362da6ea11a466d85bef577af6f759900dae4a`.
- **Capsule:** round-1-lineage clone with r2 overlaid (no 0258 review
  artifacts present).
- **Instructions (delta round):** sha256
  `53306c45d9ad62ac153fec0c84b81d1e88b6ab0e2432b8e9f382e8f2ca224778`.
- **Verdict:** NOT READY (all MATERIAL concerns classified IN-DELTA; no
  MATERIAL concern in pre-existing text).

### Review body (verbatim)

## Summary

Revision r2 makes strong progress: the D2 construction order now fits LLP 0059’s participant closure, D3 selects a fail-closed native-custody design, and the LLP 0181/0253 changes are honestly identified as amendments. However, five MATERIAL concerns introduced by the delta remain. The most serious are an unusable password-only bootstrap derivation, contradictory facade contracts, and D5 precedence depending on provenance that is neither authoritative nor durably representable. I found no separate MATERIAL concern confined to pre-existing text.

## Concerns

1. **MATERIAL — IN-DELTA — D1 derives anonymous readiness from the wrong policy axis.**

   D1 derives `anonymousPublic` from `guestPolicy` (§D1, lines 233–243), but LLP 0214’s guest policy controls creation, claiming, retention, and cleanup of a durable guest principal. Anonymous/public operation admission is separately controlled by each operation’s LLP 0058 `authRequirement`.

   This breaks the document’s primary password path: the shipped password example has `guestPolicy.enabled: false` (`guide/auth/passwords.md`), while signup and signin are public routes whose client methods require an anonymous coordinator predecessor. Mapping that program to `anonymousPublic: "refused"` leaves an ordinary provider unable to reach `ready` anonymously and therefore unable to render or call the sign-in surface through `useSnapbackAuth()`.

   Resolve this by deriving anonymous bootstrap readiness from the actual application-entry/operation posture—or by ruling that a settled anonymous authority is always a valid ready bootstrap state. Acceptance needs a password-only, guest-disabled cold-start fixture that reaches sign-in without an out-of-provider escape hatch.

2. **MATERIAL — IN-DELTA — D4’s facade contradicts its exact-result-contract rule.**

   The proposed interface returns `Promise<void>` from `signInWithPassword` and `changePassword`, and `Promise<void>` from `signOut` (§D4, lines 405–415). The shipped methods return:

   - `authPasswordSignIn`: `Promise<AuthCredentialPublicProjectionV1>`
   - `authPasswordChange`: `Promise<AuthCredentialPublicProjectionV1>`
   - `authLogout`: `Promise<null>`

   See `packages/snapback-client/index.d.mts:1477–1502`. This directly contradicts lines 418–430, which normatively prohibit narrowed results, and leaves D9 unable to generate one exact mapping.

   Either preserve those result types in the facade or explicitly decide that the facade narrows them and revise the “exact contract” rule, D9, and compatibility claims accordingly.

3. **MATERIAL — IN-DELTA — D5 makes `authoritySource` an authorization fact while declaring it non-authoritative and leaving it outside durable custody.**

   Terminology calls authority source “diagnostic provenance, never authorization” (§Terminology, lines 170–173). D5 nevertheless uses it to decide whether application entry may implicitly displace a principal and whether supervisor events may replace a bearer (§D5, lines 466–486). Those are authority-changing decisions.

   The distinction also cannot survive restart as specified. `AuthCustodyV2` is closed and exact; its implementation admits only app id, counters, phase, authority, bearer, refresh, and transition intent (`packages/snapback-contract/auth-coordinator.mjs:572–594`). It has no source field. A supervisor-issued ordinary session and an application-entered session under the same supervised binding are therefore indistinguishable after restoration. Binding source cannot recover the distinction because both sessions can exist under the same `source: "supervised-dev"` binding.

   D5 must either make source an integrity-protected, revision-coupled durable transition-control fact—requiring a real custody/protocol amendment—or redesign precedence around facts already durably authoritative. LLP 0059 cannot remain cross-reference-only if its closed custody schema changes.

4. **MATERIAL — IN-DELTA — the composed supervised displacement is not one existing LLP 0059 barrier and has unspecified race/failure semantics.**

   D5 requires sign-out to settle to a server-witnessed anonymous authority before password issuance, then adopts the issued session, while calling the sequence “one” operation “all under the existing LLP 0059 barrier” (§D5, lines 466–475). LLP 0059’s existing transition barrier is one known predecessor-to-successor transition. This flow requires two transitions with a network issuance between them.

   During the settled-anonymous interval, D5 rule 3 independently permits supervisor re-adoption. A bad password, duplicate signup, transport failure, remint, or `refreshAuthority` race therefore has no defined terminal authority or publication behavior. The existing coordinator would also resume participants after sign-out unless a new outer gate suppresses that exposure.

   Specify the outer serialization/publication owner, whether supervisor events queue or refuse during entry, the authority restored after failed issuance, and how participant callbacks remain withheld across both transitions. Add failure and remint races to Acceptance. If the existing coordinator cannot supply that outer gate, declare the required LLP 0059 amendment.

5. **MATERIAL — IN-DELTA — D5’s ready conflict diagnostic is unrepresentable, and D7 incompletely replaces the existing Expo boot protocol.**

   D5 requires `ready` with the durable principal plus `SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT` and remediations (§D5, lines 477–497). D6 says bootstrap diagnostics are exposed through provider boot state (§D6, lines 527–535). But D7’s `ready` arm contains only `custody` and `authoritySource`; only non-ready arms can carry a diagnostic (§D7, lines 545–553).

   D7 also says this union becomes the one source of truth for `ExpoBootState`, but the existing ready arm exposes `binding`, `authority`, and `preparation` (`packages/snapback-expo/index.d.mts:137–154`). `currentPrincipal` can replace the authority projection, but D7 supplies no replacement for public binding facts or the deployment-versus-persisted-receipt preparation fact. The RFC identifies a “redefined ready” without deciding whether these existing public facts survive, move, or are intentionally removed.

   Freeze an exact amended union that can represent a non-blocking ready diagnostic and explicitly dispositions every existing LLP 0181 field. Also reconcile D5’s “blocked custody” example under `authority-required` with D7’s separate `blocked` status.

6. **minor — IN-DELTA — D1 does not identify an existing source for every supposedly derived field.**

   Current `defineAuth` and `defineSchema(..., {auth})` are exact closed schemas. Neither can express custody grade or the advanced external-session seam, yet D1 says `volatile-explicit` must be explicitly written and `external-session-explicit-v1` appears when the existing program declares it. The syntax can remain implementation-phase material, but Phase 0 must name the governing auth-program amendment and its owner rather than claiming these facts are derivable from today’s program.

7. **minor — IN-DELTA — “authority key” collides with LLP 0059’s established term.**

   LLP 0258 defines it as `(app id, storage partition)`, while LLP 0059’s `CanonicalAuthorityKey`/`authorityKey` is the digest of the current anonymous or session authority and appears in captures and barriers. Rename the new pair to `bootstrapOwnerKey`, `custodyPartitionKey`, or similarly distinct vocabulary.

8. **minor — IN-DELTA — the recovery-credential boundary is stated inconsistently.**

   D4 calls signup the one deliberate boundary, while D8 calls it the “synchronous signup/rotation return value.” The shipped contract returns recovery codes from signup, recovery consumption, and recovery rotation (`packages/snapback-client/index.d.mts:1473–1498`), all asynchronously. State that there is one admitted *boundary class* with those three methods, and make scans enumerate all three.

## Implementation-phase notes

- D3’s per-OS probes should include crashes between comparison and replacement, attempted background-task/extension access, backup/restore and reinstall behavior, record-size limits, and proof that a declared single-runtime profile actually rejects every second writer.
- D2 acceptance should cover final-reference disposal, remint on the same owner, and explicit partition selection for side-by-side targets. The exact option spelling is implementation-phase material.
- D9 should generate the facade return types directly from the shipped client declarations so future recovery and credential methods cannot repeat the D4 drift.

VERDICT: NOT READY
