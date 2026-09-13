# Review artifact: LLP 0258 — grok family

Target: `llp/0258-first-party-application-auth-bootstrap.rfc.md`

## Round 1 — 2026-08-15

- **Reviewer:** grok CLI, model grok-4.6 (`--reasoning-effort xhigh`,
  `--disable-web-search`), blind.
- **Revision under review (r1):** sha256
  `fbea549187d56e9dcd82a42485d4a1be4202ed76f3832e6f753237576c3b7362`
  (landed commit `4cc971ea4`).
- **Capsule:** APFS clone of `git archive 4cc971ea4` export, no 0258 review
  artifacts or run journal present (structural blindness).
- **Instructions:** sha256
  `b730742554df966819f527c877bb4b12be01c86218d3777d4f68abb848c373eb`.
- **Verdict:** NOT READY.
- Note: the leading narration sentences are part of grok's plain-output
  stream and are preserved verbatim.

### Review body (verbatim)

I'll start by reading the review skill, the target RFC, and the governing related LLPs so the review is grounded in the actual protocols and code.The RFC is loaded. Next I’ll read the governing LLPs and check the current auth, custody, and provider code against the RFC’s claims.I’ll pull the governing sections from the related LLPs and locate the current auth/custody implementations in code.I’ll read the load-bearing LLP sections next—custody, provider, password surface, and currentPrincipal—then check them against the packages.The protocol tension around supervised adoption vs. durable restore looks load-bearing. I’ll verify that in the provider, coordinator, and `client.auth` implementations.The Expo path currently injects a bearer and skips `AuthCoordinator`. I’ll check the guide adapter, diaries, and how partition/anonymous posture are specified.The central decision in LLP 0258 is right: Snapback is missing a composition owner, not a second auth protocol. I checked that claim against the current packages. `AuthCoordinator` already owns custody and the 0059 barrier (`packages/snapback-contract/auth-coordinator.mjs`). Password signup/sign-in already adopt only through the anonymous-issuance path and refuse without a coordinator (`packages/snapback-client/index.mjs`, `#authPasswordAnonymousIssuance`). The ordinary Expo path does not use that owner: `createSupervisedExpoEnvironment.adoptAuthority` builds `createExternalSessionClient` with the mint bearer, and `refreshAuthority` calls `replaceBearerToken` (`packages/snapback-expo/supervised-environment.mjs`). That constructor is mutually exclusive with `AuthCoordinator` (`createExternalSessionClient` in `packages/snapback-client/index.mjs`). The guide’s SecureStore snippet is a process-local queue over `getItem`/`setItem` (`guide/backend/familiar-profile.md`). So the problem statement is real.

What is not closed is the composition contract itself. Several decisions still contradict owned protocols, leave the motivating Expo+password race open, or defer choices the RFC itself says must be settled before Accepted.

## Concerns

1. **MATERIAL — D3, Open questions 1, Phase 0, Status.** The native durable carrier is still an open design choice, and this RFC correctly says it cannot be deferred to implementation. LLP 0059 requires Web Locks or a compare-and-swap lease in the *same transactional domain* as the custody record, and fails closed with `SNAPBACK_AUTH_CUSTODY_LOCK_UNAVAILABLE` otherwise (LLP 0059#cross-context-ownership). `expo-secure-store` plus the guide’s in-process tail queue is not that adapter. Accepting 0258 while OQ1 is unresolved would accept a Sessions-default `durable-required` native path with no chosen carrier that can meet the protocol this RFC claims to preserve. Phase 0’s implementation probe can inform the choice; it is not a substitute for writing the choice into D3. Even the “single-runtime” option still needs 0059 compare-and-replace and owner fencing, not a mutex around `getItem`/`setItem`.

2. **MATERIAL — D5, D1, D4, Goal 1, LLP 0227, LLP 0181#provider.** D5 does not close the supervised-versus-password composition that motivates the document. D5 only prevents a supervised session from overwriting a *durable authenticated* user. First run has no such user: 0059 creates a store only after a server-witnessed anonymous handshake (LLP 0059#transition-barrier), and D5.3 then allows supervised mint to adopt that anonymous predecessor “when the generated policy admits the development entry.” After that adoption the coordinator is a session, and LLP 0227 / `#authPasswordAnonymousIssuance` refuse signup and sign-in unless the predecessor is anonymous (`packages/snapback-client/index.mjs`). The ordinary Expo app therefore still cannot sign up with password without first signing out of a supervised persona the author never asked for. D1’s `ApplicationAuthBootstrapV1` has no development-entry field, so D5’s predicate is not even a generated fact. D5.2’s “entry may transition that settled predecessor under its normal rules” does not help: the normal password rule *is* anonymous issuance. Implicit sign-out-then-issue is a new rule and is not written. This is the Clique/Expo seam the RFC set out to own, and it remains open.

3. **MATERIAL — D5, LLP 0181#provider, `refreshAuthority`.** D5 is specified only as *startup* precedence. The shipped Expo live path can still replace a durable user after boot. `createSnapbackExpoBoot.refreshAuthority` pauses the React provider and calls `environment.refreshAuthority` (`packages/snapback-expo/provider.mjs`). The supervised environment then `replaceBearerToken`s any new exchange token (`packages/snapback-expo/supervised-environment.mjs`). LLP 0181 remints the binding on descriptor change and treats that refresh as ordinary authority replacement (LLP 0181#supervised-development-baseline, E1). A password-signed-in user who hits HMR or a function edit can still be overwritten by the next mint. D8’s “no automatic latest-credential-wins” rule is false until remint, `refreshAuthority`, and any successor-graph binding rewrite are under the same precedence as boot.

4. **MATERIAL — D2, Constraints, LLP 0059#client-custody-and-authcoordinator, Goal 3.** The process-local owner key is not a closed identity and fights 0059. Constraints repeat 0059: one logical `AuthCoordinator` per canonical app id and storage partition. D2 then keys the bootstrap owner by “canonical app id, storage partition, *and binding target*” and says a different binding target “cannot silently share authority.” LLP 0181’s `target` is `{ app, schema, functions, origin, routing }`; `schema`/`functions` rotate when the supervisor remints a generation (LLP 0181#supervised-development-baseline). If that whole tuple is in the owner key, every codegen remint is a new owner. If those owners share 0059’s app-id custody database (`snapback-auth-custody` in LLP 0059#durable-custody-record / `packages/snapback-contract/auth-custody-indexeddb.mjs`), one JavaScript context gets two coordinators on one durable record, which 0059 forbids. If they do not share storage, Goal 3’s “restore without reissuing a credential” dies on the first remint. The ordinary partition formula is also unspecified; the shipped Expo default `clientStoreId: snapback-expo-${supervisorGeneration}` (`packages/snapback-expo/supervised-environment.mjs`) is the value an implementer will copy, and it is the wrong axis for *auth* custody. D2 needs a closed key: app id plus an explicit, stable partition, with binding origin as transport/handshake input rather than a second coordinator identity.

5. **MATERIAL — Scope, Phase 0 item 3, D5, D7, OQ3, LLP 0181#provider, LLP 0238#d6.** The 0181 ownership boundary is not closed, and the RFC’s claim that dated amendments will not change underlying protocols is false. LLP 0181 currently owns “separately adopts an ordinary application session,” defines `ready` as that adoption having completed, and forbids converting missing authority into anonymous success (LLP 0181#provider; `@ref` on `createSnapbackExpoBoot` in `packages/snapback-expo/provider.mjs`). D5 makes durable restore win and restricts supervised mint to an anonymous predecessor. D7 makes `ready` mean construction/custody sync, not an authenticated session, which is the 0238 split (`currentPrincipal` vs boot). OQ3 is still open and is exactly whether `anonymousPublic: "allowed"` can be `ready` before durable custody exists; 0181’s current answer is no. You cannot keep 0181’s boot state machine and also ship D5/D7. Phase 0 must *amend* 0181 (and decide OQ3 in the Decision section): `ready` may be anonymous; supervised mint is no longer automatic adoption; `refreshAuthority` is not a bearer setter. Saying 0181 “remains the owner” while changing its adoption and `ready` meaning leaves two live protocols.

## minor concerns

6. **minor — D4, D6, LLP 0238#d6.** D4 says `auth` “delegates to the existing `client.auth` namespace,” and D6 says `useSnapbackCurrentPrincipal()` is used “unchanged.” Those are 0238 contracts, not shipped surfaces. Today the methods are flat (`authPasswordSignup`, `authPasswordSignIn`, `authLogout`, `authSession`) and there is no `client.auth.*` or `useSnapbackCurrentPrincipal` in `packages/snapback-client` / `packages/snapback-react`. Password methods and logout already require `AuthCoordinator`. Treat 0238 as the vocabulary this RFC implements, not as an existing module to wrap.

7. **minor — D4 vs LLP 0238#d6.** D4 refuses entry while predecessor state is “loading, refreshing, clearing, blocked, or incompatible.” 0238’s closed public union is `loading | anonymous | authenticated | refreshing | blocked`. `clearing` is an internal 0059 phase; `incompatible` is not a public state. Map those onto `loading`/`blocked` plus a 0238/0247 diagnostic instead of widening the union.

8. **minor — D4 vs Acceptance.** Acceptance requires password change on the same `currentPrincipal` and barrier. The D4 facade only shows signup, sign-in, and sign-out, while `authPasswordChange` / `authPasswordSet` / `authPasswordReset` already exist on the client. Either put change on the v1 facade or narrow Acceptance. “Beginning with LLP 0227” is not enough while Acceptance names change.

9. **minor — D3.** The platform matrix has Browser versus Expo iOS/Android and omits Expo web (`--expo-platform web` in LLP 0181). That carrier must be the IndexedDB + Web Locks adapter, not the native one.

10. **minor — D6/D7 vs LLP 0181 `ExpoBootState`.** D7’s `AuthBootstrapSnapshot` and 0181’s `ExpoBootState` are different unions (`custody` stage and `authoritySource` versus `binding`/`authority` public facts). D6 says diagnostics go through provider boot state. Freeze one union or an explicit projection in Phase 0 so boot is not two sources of truth.

11. **minor — Related.** Diary 0079 and Diary 0083 are cited; this capsule’s diary series ends at 0077. The Clique 0.1.21 composition story is plausible from current Expo/client code but is not verifiable from those diary ids here.

12. **minor — D6, LLP 0253 S6.1.** Familiar’s v1 export list is closed (`SnapbackProvider`, `useQuery`, `useMutation`, `useAction`, `useQueryState`, `skip`). Re-exporting `useSnapbackAuth` / current-principal aliases is a 0253 amendment, which Phase 0 already plans. Keep that explicit so Familiar does not grow an auth owner by side effect.

## Implementation-phase notes

These do not block READY by themselves once the MATERIAL items are closed.

- D2 construction lists custody sync (step 6) before constructing the Snapback client (step 7). 0059 boot handshake is `GET /auth/session` and today’s `#coordinatedAuthSession` lives on the client. Build an unpublished client, sync, then release it; do not invent a second handshake owner.
- Do not register the React/Expo *provider component* as an LLP 0059 participant. `blank`/`clearMemory` are synchronous and must not call app code (LLP 0059#participant-contract). Register the store, transport, outbox, and connection owners the provider already projects.
- Reference-counting must survive Strict Mode, Fast Refresh module reset, and a refcount drop to zero during remount without leaking a second live coordinator on the same app/partition, and without `dispose()` logging out (D2 is correct that dispose is not sign-out).
- Do not emit native `durable-required` opt-in until the D3 carrier exists. Capability-gating in Compatibility is the right brake.
- Supervised adoption into the coordinator, once D5 is fixed, should handshake the mint bearer and `transition` anonymous → session. Do not keep `createExternalSessionClient` / `replaceBearerToken` on the ordinary path; 0096 already says that seam is not coordinator ownership.
- A single-runtime native profile, if chosen, still needs crash-safe CAS on the full `AuthCustodyV2` record, including the bearer. Splitting bearer into SecureStore and metadata into another store breaks 0059’s same-transaction lease rule.

I do not want a wholesale redesign. One first-party bootstrap owner over 0059/0227/0238/0181 is the right product. It is not ready to accept until the native carrier is chosen, D5 covers first-run *and* remint, the owner key matches 0059, and 0181 is amended instead of being declared unchanged.

VERDICT: NOT READY

## Round 2 (delta round) — 2026-08-15

- **Reviewer:** grok CLI, model grok-4.6 (--reasoning-effort xhigh, --disable-web-search), blind.
- **Revision under review (r2):** sha256
  `840995cbb6e87582ca7c2fc035362da6ea11a466d85bef577af6f759900dae4a`.
- **Capsule:** round-1-lineage clone with r2 overlaid (no 0258 review
  artifacts present).
- **Instructions (delta round):** sha256
  `53306c45d9ad62ac153fec0c84b81d1e88b6ab0e2432b8e9f382e8f2ca224778`.
- **Verdict:** NOT READY (all MATERIAL concerns classified IN-DELTA; no
  MATERIAL concern in pre-existing text).
- Note: the leading narration sentences are part of grok's plain-output stream and are preserved verbatim.
### Review body (verbatim)

I'll review LLP 0258 r2 as a mutually-blind delta review: first the review skill and the RFC, then the r2 changes against the cited corpus and code.The RFC is loaded. Next I’ll check LLP 0005 and the cited corpus so the r2 delta can be verified against the actual protocols.I’ll pull the governing LLPs next—0059, 0181, 0227, 0238, and the related protocol docs—so the r2 claims can be checked against the actual contracts.I’ve got the section map. Next I’ll read the load-bearing protocol text for authority keys, boot state, password contracts, and the 0238 union.D4’s “exact result contract” claim needs a code check—signup/sign-in return types and recovery-rotate look like they may not match the facade.Revision r2 is a real improvement: the owner key now matches LLP 0059, construction order matches participant registration, OQ3 is resolved conservatively, the native carrier is fail-closed, and the 0181/0253 amendments are named as protocol changes. Three r2 decisions still conflict with shipped contracts or with each other, so this revision is not ready.

## Concerns

### 1. MATERIAL · IN-DELTA — D1’s “derived projection, never a second configuration” is not implementable as written

**D1** says `ApplicationAuthBootstrapV1` is derived from the existing normalized `defineAuth` / schema auth program, that “every” field comes from that program, and that “no bootstrap-policy field can be authored independently or disagree with the program.” Two fields break that rule.

**`custody` has no source in the existing program.** LLP 0214’s closed `defineAuth` declaration has mechanisms, providers, guest policy, recovery policy, and related fields — not a durable/volatile custody grade. The shipped coordinator is constructed with an injected `storage` adapter and an `appId` only (`packages/snapback-contract/auth-coordinator.d.mts`). D1 then requires `volatile-explicit` to be “written explicitly.” Those two sentences cannot both hold: either custody is a second authored input (contradicting the r2 thesis), or it is default-only and cannot be written. Phase 0 does not name an LLP 0214 amendment that would add the field. Codegen cannot implement the derivation rule.

**`anonymousPublic` from “the guest policy” is a category error.** LLP 0214 §2.8 `guestPolicy.enabled` admits *guest principals* (claimable user rows, default disabled). LLP 0238/0059 `anonymous` is *no principal*. Per-function public access is the separate Familiar/canonical enum `"public" | "optional-user" | "authenticated"` (LLP 0253 S4.2) and schema `visibility: public-read`. Mapping `guestPolicy.enabled` onto `anonymousPublic` does the wrong thing in both directions:

- Platform default `guestPolicy.enabled: false` would derive `anonymousPublic: "refused"`. If that refusal is enforced at bootstrap (D2 step 8 releases public work only after confirmation; D7 `ready` is that gate), an ordinary password app cannot present a sign-in screen — 0227 signup/signin require a settled anonymous coordinator.
- An app can enable guests and still require a guest session for every route, or disable guests and still serve public-read queries. Those are expressible programs today; D1 would mis-project them or refuse them as “unexpressible.”

What would resolve this: name the real derivation (or amendment) for each `ApplicationAuthBootstrapV1` field. `custody` is a client-persistence grade and needs an explicit authoring seam or a declared default-only rule. `anonymousPublic` should follow whether the normalized program admits anonymous/public work (public operations / guest-less anonymous handshake), not 0214 guest enablement.

### 2. MATERIAL · IN-DELTA — D2’s construction-time binding-conflict rule fights remint and the remount path the RFC claims to support

**D2** keys the owner by `(canonical app id, storage partition)` and treats binding target as `(origin, routing, schema/functions generation identities)`. Same key + same target is reference-counted reuse (the Strict Mode / Fast Refresh fix). Same key + different target is `SNAPBACK_AUTH_BOOTSTRAP_BINDING_CONFLICT` until dispose. In the same breath, a supervisor remint “rebinds transport facts on the same owner and cannot mint a second authority owner.”

Those two rules collide on the ordinary Expo path. LLP 0181 remints the binding for a new `descriptorIdentity` while keeping supervisor generation and route; `AppBindingV1.target` includes `schema` and `functions`. A generation remint is therefore a different binding target. The common sequence is: live owner still holds B0, Fast Refresh / Strict Mode overlap mounts a second constructor with reminted B1. D2’s reuse clause does not apply (targets differ); the conflict clause does. That is the exact remount overlap Acceptance says must produce one owner, and it is the remint D2 says must rebind rather than refuse.

In-place remint on an already-held owner is specified. Construction with a successor generation identity of the same authority key is not. The current Expo environment already resolves a new binding and constructs again (`packages/snapback-expo/supervised-environment.mjs`, `provider.mjs`); r2 is supposed to make that safe.

What would resolve this: either drop schema/functions generation identities from the construction-conflict predicate (keep them as rebind inputs), or define construction against a live owner with a successor generation of the same app/partition/origin as a rebind, not a refuse. Conflict should remain for a genuinely different origin/routing/app.

### 3. MATERIAL · IN-DELTA — D5’s “every remediation is executable through the specified API” names a partition the specified constructor cannot set

**D2**’s normative constructor is `createSnapbackAppClient({ app, binding, platform })`. The authority key’s second half is storage partition; the default is a stable per-app constant, never supervisor-generation-derived. **D5** then lists three remediations for supervised conflict, all supposedly executable through the specified API, including “reconstruct with a separate storage partition.” D2 also says two targets side by side “give them explicit distinct storage partitions.”

Nothing in the specified ordinary API accepts a partition. `AppBinding` is forbidden to carry authority (Constraints, LLP 0181). `platform` selects a custody adapter, not an authority-key component. `AuthCoordinator` today has no `storagePartition` option — partition is whichever storage object you inject. Names may change under API review; the ownership shape is declared normative, and that shape includes a key component with no ordinary input.

Without that input, the third D5 remediation is not executable, and the multi-target escape hatch is only the advanced storage-injection path this RFC is trying to keep off the ordinary journey.

What would resolve this: add an explicit ordinary construction input for storage partition (defaulting to the stable per-app constant), and write the conflict remediation as that call. Do not smuggle partition through binding or Metro environment.

### 4. MATERIAL · IN-DELTA — D4’s “exact result contract, never a narrowed result” is false for the facade it specifies

**D4** makes exact contract preservation the rule, then types:

```ts
signInWithPassword(...): Promise<void>
changePassword(...): Promise<void>
```

Shipped client contracts (`packages/snapback-client/index.d.mts`, `password-auth.test.mjs`):

| Method | Actual return |
| --- | --- |
| `authPasswordSignIn` | `Promise<AuthCredentialPublicProjectionV1>` |
| `authPasswordChange` | `Promise<AuthCredentialPublicProjectionV1>` |
| `authPasswordSignup` | `Promise<AuthRecoveryCredentialPublicProjectionV1>` |

Signup is right. Sign-in and change are narrowed to `void`. Callers today assert `result.session.userId` after sign-in. D9 tells the remaining methods to join “under the same exact-contract mapping,” which cannot mean both “preserve `AuthCredentialPublicProjectionV1`” and “the facade returns `void`.”

This is not a style detail. r2 elevated exact-contract preservation specifically so recovery codes would not be elided. The same sentence forbids the void narrowing written two lines later.

What would resolve this: give each facade method the same return type as the client method it wraps (`AuthCredentialPublicProjectionV1` for sign-in/change; recovery projection for signup/consume/rotate), *or* drop the exact-contract rule for non-recovery methods and say `currentPrincipal` replaces those returns. Do not keep both.

### 5. minor · IN-DELTA — D8’s “exactly one” recovery boundary omits consume, which the shipped type already names

**D8** and Acceptance: one-time recovery credentials cross “exactly one deliberate boundary — the synchronous signup/rotation return value.” **D4** only highlights signup, then says recovery consumption joins via D9 with exact contracts.

Shipped `AuthRecoveryCredentialPublicProjectionV1` is “returned only by signup/consume/rotate.” LLP 0214 §9 and R-04/R-06 require consume to return the replacement plaintext set once. Eliding consume to satisfy a literal reading of D8 would destroy recovery custody; including it violates “exactly one” / “signup/rotation.”

Treat the admitted class as every `AuthRecoveryCredentialPublicProjectionV1` return (signup, consume, rotate), matching 0214’s one-time-response rule. Not blocking if D4’s exact-contract join is honored.

### 6. minor · IN-DELTA — D2’s term “authority key” collides with LLP 0059’s loaded name

**Terminology / D2** define authority key as `(canonical app id, storage partition)` and call that “exactly LLP 0059’s coordinator and custody identity.” In 0059, `CanonicalAuthorityKey` / capture `authorityKey` is `sha256:` of `{appId, kind, authMode, incarnation, ...}` — a different object. Coordinator identity is “one `AuthCoordinator` per canonical app id and storage partition.” The pair is the right owner key; the name will be misread as the capture digest. Prefer “coordinator key” / “owner key.”

### 7. minor · IN-DELTA — D7 “one union, one source of truth” does not say what happens to 0181’s binding facts

**D7** takes ownership of `AuthBootstrapSnapshot` and amends `ExpoBootState` to project it. The owned `ready` arm is `{ custody, authoritySource }`. Today’s 0181 `ready` is `{ binding: PublicBindingFacts, authority: PublicAuthorityFacts }`. The listed surface changes (new `custody` stage, `blocked`, redefined `ready`) do not say whether binding inspection survives. “One union” can be read as deleting it. Specify a projection that keeps 0181’s binding facts and uses this RFC’s construction-status union as the inner source of truth.

### 8. minor · IN-DELTA — D5 uses `authoritySource` as a transition predicate but does not say whether it survives restore

**Terminology** calls authority source “diagnostic provenance, never authorization.” **D5** uses it to decide displacement vs refuse, and whether remint/`refreshAuthority` may replace a bearer. `AuthCustodyV2` has no such field. After process death, a supervised persona restored by D5 rule 1 will look like “restored custody” unless the source is persisted. Then password entry loses the composed displacement, and remint must not replace a dead minted session. Pick one: persist source with a closed write path, or define restore as always `restored` and specify how a still-supervised developer persona is refreshed (coordinator 0057 refresh, not remint-as-bearer-setter).

### 9. minor · PRE-EXISTING — `changePassword` on the facade is only the rotate arm of 0227’s closed change union

**D4** adds `changePassword` and leaves set/reset/consume to D9. 0227’s change route is a closed union: rotate (`currentPassword, newPassword`) or set (`currentPassword: null` + step-up). The facade type `PasswordChangeInput` is unspecified. Fine as Phase 1 scope if D9’s exact-contract row includes `authPasswordSet`. Record it so set is not silently folded into `changePassword` and the step-up proof dropped.

## Implementation-phase notes

- Phase 0’s 0181 amendment must change `SnapbackExpoEnvironmentV1.adoptAuthority`: today the provider treats a missing ordinary session client as `authority-required` (`packages/snapback-expo/provider.mjs`). “`ready` may be anonymous” and “conflict never wedges” are not implementable against that success contract.
- After `signOut()` under D5 conflict, say what triggers supervised re-admission under rule 3 (`refreshAuthority()`, next remint, or immediate). “Let supervised bootstrap re-admit” is not an API.
- D5’s example of blocked custody as `authority-required` overlaps D7’s separate `blocked` status. Use `blocked` for 0059 corrupt/exhausted custody; reserve `authority-required` for no settleable authority (e.g. Sessions mode unset).
- D2’s “unreleased” client should stay a bootstrap publication fence (do not return the projection until step 8), not a new `SnapbackClient` protocol. 0059 already registers the transport participant at construction and confirms before exposure.
- D3’s whole-record native CAS is feasible as a single-runtime, read-verify blob if Phase 0 records that lease + record stay in one atomic domain (0059’s same-database `custody`/`leases` rule). OQ1 is the right remaining question.
- Familiar S6.1 re-export names are an amendment detail; they must remain aliases over the same owner, as D6 already says.

r2’s direction is right. The blocking work is to make D1’s derivation actually correspond to 0214/0253, stop treating generation remint as a construction conflict, put partition on the ordinary constructor, and stop claiming exact result contracts while typing `void`.

VERDICT: NOT READY

## Round 3 (delta round) — 2026-08-15

- **Reviewer:** grok CLI, model grok-4.6 (--reasoning-effort xhigh, --disable-web-search), blind.
- **Revision under review (r3):** sha256
  `2fb1bd9f96d695e6231836a61ceba07d6a35905d0ba7dfbf9d8ccf460829895b`.
- **Capsule:** round-2-lineage clone with r3 overlaid (no 0258 review
  artifacts present).
- **Instructions (delta round):** sha256
  `2f2a7c33898003286e01a19c09ffae13e17a347723f81c34c8d5e8e4f6de2e32`.
- **Verdict:** NOT READY (1 MATERIAL, IN-DELTA; sole PRE-EXISTING item is minor).
- Note: the leading narration sentences are part of grok's plain-output stream and are preserved verbatim.
### Review body (verbatim)

I'll review LLP 0258 r3 as a mutually-blind independent reviewer: load the review skill, read the RFC and the r3 delta against the cited LLPs and shipped packages, then write a verbatim review artifact.The RFC is loaded. Next I’ll check the cited LLPs and shipped client contracts so each r3 claim can be classified against the corpus, not just the document.I have the citation map. Next I’ll read the governing sections in 0059, 0181, 0214, 0227, and 0238 and compare them to the shipped client types.Several delta claims need corpus checks: logout return types, 0238’s `client.auth` namespace, 0181 boot fields, and whether 0059 actually allows withheld exposure across two transitions.Logout returning `null` matches the facade. Next I’ll check AppBinding, 0181 boot fields, 0059 exposure, and the recovery-credential surfaces for the remaining r3 claims.I’m checking AppBinding, Expo boot types, 0253’s export list, and 0059’s storage-key rules against the r3 rebind and field-disposition claims.Revision r3 is a real tightening of the composition RFC: the owner-key / `CanonicalAuthorityKey` split is correct against LLP 0059, `guestPolicy` is correctly excluded from `anonymousPublic`, facade return types match the shipped client, the recovery boundary matches the three shipped `AuthRecoveryCredentialPublicProjectionV1` sites, and the 0181 boot-field dispositions match the shipped `ExpoBootState` (`binding`, `authority`, `preparation`). One in-delta decision still fails: D2 treats every schema/functions remint as reference-counted reuse, which cannot absorb the bootstrap-policy semantic rotations D1 itself places under LLP 0241.

## Concerns

1. **MATERIAL · IN-DELTA — D2 / D1 / Constraints / LLP 0241.** The r3 rebind/conflict split says a live owner whose binding target differs only by successor **schema/functions generation identities** “resolves as reference-counted reuse: the owner applies the reminted binding” and that ordinary remints, HMR, and Strict Mode therefore keep “one owner and one coordinator.” That is the right rule for a same-policy remint. It is the wrong rule for the policy rotations this RFC itself declares. Constraints and D1 say custody grade, sessions posture, and admitted mechanisms are LLP 0241 semantic inputs that “require ordinary generation/admission.” LLP 0241 D1 puts authority in `semanticId` and requires fail-closed crossing of incompatible custodians; its constraints forbid silently retargeting an in-flight auth exchange onto new semantics. `AppBindingTargetV1` confirms `target.schema` / `target.functions` are the rotating hashes and `target.app` is the stable canonical app id, so an HMR that edits `defineAuth` (add `password`, flip `durable-required` ↔ `volatile-explicit`, change `anonymousPublic`) is exactly a generation-identity-only remint — D2’s reuse case. The owner has already instantiated a custody adapter and a mechanism table from the *previous* policy. Reuse-plus-binding-apply cannot lawfully absorb those rotations: a volatile owner rebound onto `durable-required` is the “memory custody where process-restart persistence was intended” failure Motivation lists; a password-less facade rebound onto `password-v1` never grows the entry surface. D2 names only the reminted **binding** as what reuse applies, not the new generated `app` / bootstrap policy, and it gives no reconstruction-or-refuse predicate when instantiated owner state disagrees with the successor policy. Resolve by splitting rebind: same owner key and compatible policy/semantic identity → reuse and apply binding **and** generated policy; a 0241 authority/policy rotation → reconstruct or typed refuse, not reference-counted reuse of the old coordinator/adapter/mechanism table.

2. **minor · IN-DELTA — D1 `entryMechanisms` / Terminology / no-silent-narrowing.** r3 pins `entryMechanisms` to “the admitted mechanism/provider set” and retains “a program the policy schema cannot express is a codegen refusal, not a silent narrowing.” The closed enum is only `password-v1` | `email-code-v1` | `external-session-explicit-v1`. LLP 0214 v1 also admits `guest` and a `passkey` slot; `guestPolicy.enabled` is the starter-template default (0214 §2.8; `packages/snapback-cli/templates/expo-chat`). Terminology’s “entry mechanism” examples do not include guest (guest creates a principal; it does not prove control). Without an explicit “guest/passkey are not bootstrap entry mechanisms; their presence neither refuses generation nor appears in the allowlist,” implementers can lawfully refuse the ordinary Expo template this RFC’s Goal 1 is supposed to serve. Pin that exclusion in D1.

3. **minor · IN-DELTA — D5 “participant and application exposure” / Phase 0 “unchanged 0059”.** The parenthetical (“the same withholding it uses during construction”) is the intended meaning: D2 already registers 0059 participants and withholds only **public** release until settled confirmation. The lead sentence still says participant exposure is withheld. That cannot be literal. LLP 0227 signup/sign-in are anonymous-issuance and require a settled anonymous coordinator; `AuthCoordinator.transition` exposes registered participants on each settle. Construction-style public-release gating is implementable; skipping 0059 participant recapture on the intermediate anonymous successor is not, and would be a 0059 change Phase 0 forbids. Strike “participant and” or define withholding as application/`currentPrincipal` publication only.

4. **minor · IN-DELTA — D2 facade as “projection of `client.auth`” vs D4/D5 composition.** 0238 D6 spells `client.auth.currentPrincipal` / `subscribeCurrentPrincipal` and says 0227 methods join that namespace. D4 correctly wraps shipped `authPassword*` / `authLogout` contracts (verified: `AuthCredentialPublicProjectionV1`, `AuthRecoveryCredentialPublicProjectionV1`, `authLogout() → null`). D5 displacement cannot live on `SnapbackClient` without the owner’s process-local record, and today’s `authPasswordSignIn` already requires an anonymous coordinator. The facade is a composing layer that *adds* owner-serialized sign-out-then-issuance. Call it that. “Projection, not a second home” will push implementers to put D5 on the low-level client.

5. **minor · IN-DELTA — D5 deferred remint after failed issuance.** The failure arm (settled anonymous + typed diagnostic, not a fallback re-adopt) is consistent with rule 3 if a mid-entry remint is **refused/dropped**. If it is **deferred** and then runs against the anonymous successor, rule 3 re-admits immediately and the diagnostic is not a stable terminal. “Deferred or refused” plus “never silent re-adoption” needs one word: drop (or rebind-only, no rule-3 adopt) remints that arrived during a failed displacement.

6. **minor · IN-DELTA — Phase 0 “0252 cross-reference only” vs the 0214 `defineAuth` amendment.** Adding authored `custody` and the external-session seam grows the closed `defineAuth` object (`packages/snapback-codegen/define.mjs` exact keys today have neither). LLP 0252 D1 requires a Familiar disposition for every new canonical field. D1’s prose already implies profile-default `durable-required`; Phase 0 should say that so Familiar is not left in 0252 disposition limbo.

7. **minor · PRE-EXISTING — owner key vs shipped custody addressing.** 0059’s coordinator identity is (canonical app id, storage partition); shipped `createIndexedDbAuthCustodyStorage` keys the object store by `appId` only, and `AuthCoordinator` has no partition parameter. r3 is right to make `storagePartition` an ordinary constructor input and the D5 side-by-side/conflict remediation, and right that `AuthCustodyV2` needs no new field (partition is store identity). The remediation is false unless first-party adapters actually key by the full owner key.

## Implementation-phase notes

These identify no further defective decision.

- **0238 state during displacement.** The only closed-union implementation of “one predecessor→successor exposure” that does not become a competing signed-in cache (Constraints) is to project `loading` or `refreshing` for the span, then `authenticated` or `anonymous`. Do not retain the supervised snapshot after the coordinator has left that authority.
- **Adapter keying.** IndexedDB / native / memory adapters must address records by `(appId, storagePartition)`. Default partition stays a stable per-app constant, never `clientStoreId` (shipped Expo uses `snapback-expo-${supervisorGeneration}` as a query-store id; D2’s axis split is correct).
- **0181 amendment shape.** Shipped `ExpoBootState.ready` is `{ binding, authority, preparation }` with `preparation.source: 'deployment' | 'persisted-receipt'` — D7’s keep-binding-and-preparation claim is accurate. `AuthorityAdoptionResult.ready` still requires `publicFacts.kind: 'session'`; the anonymous-ready amendment must change that type, not only the prose. Map `PublicAuthorityFacts` (`sessionId`, `sessionGeneration`, `authorizationStreamIncarnation`, `authMode`) onto 0238’s authenticated arm or explicitly drop them.
- **When rule 3 runs.** Pin whether supervised adoption happens inside D2 steps 6–8 (before public `ready`) or as a post-`ready` supervisor event. Both are legal; the Expo golden path wants the former to avoid an anonymous flash.
- **Rebind vs `refreshAuthority`.** Today’s `refreshAuthority` is a `replaceBearerToken` path and does not re-admit a reminted binding. The Phase 0 0181 amendment has to grow a real generation rebind (new descriptor/schema/functions, same owner key) that is not a bearer setter.
- **D9 vs deferred mechanisms.** `email-code-v1` can appear in derived policy before the facade grows a method (D4). Do not turn that into a Phase 1 completeness failure; D9’s gate belongs with the Phase 3 mechanism table.
- **`changePassword` is not entry.** D4’s “entry call while authenticated refuses” must not apply to the rotate arm; 0227 change is authenticated same-authority rotation (`withCredentialRotation`), not anonymous issuance.

VERDICT: NOT READY

## Post-convergence r4 delta review — 2026-08-15

- **Reviewer:** grok CLI, model grok-4.6 (--reasoning-effort xhigh, --disable-web-search), blind.
- **Revision under review (r4 + post-loop editorial):** sha256
  `bd7c5f0fcf15a080cdd4f373266d2d1aa27afb2b2cb588f00dc283391a7b43d8` (capsule = origin/main `699b7f907` export, 0258 review
  artifacts excluded, landed implementation included).
- **Instructions:** sha256 `f7cb346bbd049b5bba5f9b15bd3c54cbe60586732dcc3519769873a237eabad8`.
- **Verdict:** NOT READY — 2 MATERIAL IN-DELTA (Acceptance oracle vs D5 drop rule; authority-source union not closed over the peer-won arm), 2 minor. NOTE (orchestrator adjudication): grok's claim that the shipped owner already drops mid-entry adoption was verified FALSE against the capsule — the drop branch was dead code, exactly as codex found; the code was fixed in the same landing as this artifact.
- Note: the leading narration sentences are part of grok's plain-output stream and are preserved verbatim.
### Review body (verbatim)

I'll review the r3→r4 delta independently: first the LLP-review procedure and the target RFC, then the landed Phase 0/1 code and tickets those claims depend on.The RFC is longer than the first read; next I’ll take the implementation record, revision history, and the landed Phase 0/1 code those claims rest on.I’ll verify the r4 claims against the owner, adapters, and remaining tickets, and stay off prior reviews of this RFC.The remint/0241 successor-proof story and the facade/client split both look load-bearing — I’ll read those surfaces and the related LLPs next.The shipped `AuthoritySource` union and the 0241/0238/0214 surfaces are the next check against the r4 wording.The r3→r4 delta mostly lands the right closures: `fresh-anonymous` makes cold boot and post-sign-out representable, guest/passkey/recovery stay out of `entryMechanisms`, `changePassword` is rotation not entry, the process-local capture is bound to the exact authority the owner transitioned, mid-entry remints drop rule-3 adoption, adapters address the full owner key, and the LLP 0214/0252 custody dispositions match the shipped codegen. Two in-delta holes remain. Acceptance still describes the r3 remint and single-exposure rules that r4 replaced, and the authority-source set r4 claims is complete has no arm for the peer-won session D5 itself now produces (the shipped owner invents `external-transition`).

## Concerns

1. **MATERIAL · IN-DELTA — Acceptance still specifies the r3 remint and exposure rules that r4 D5 replaced.**  
   D5 now says a remint that arrives mid-entry is **dropped** (rebind facts only, no rule-3 adoption) and that re-admission happens only on a later supervisor event; the single-exposure guarantee is scoped to the initiating JavaScript context; withholding is only public application / `currentPrincipal` publication; and participants recapture normally on the intermediate anonymous successor (D5, “If issuance fails after the sign-out settled…”, “That single-exposure guarantee is scoped…”, “withholds **public application and `currentPrincipal` publication**”).  
   Acceptance still requires that “a remint or `refreshAuthority` arriving mid-entry is **deferred or refused**” and that “applications observe **exactly one** predecessor→successor exposure across the composed span.” “Deferred” is the unsafe behavior r4 explicitly rejected (“dropped, not deferred-then-adopted,” Revision history r4). “Exactly one exposure” is also false under r4: initiating-context queries recapture through the anonymous intermediate, and peer contexts see the ordinary LLP 0059 broadcast sequence (supervised → anonymous → session; LLP 0059, peer adoption / broadcast of the settled successor).  
   A tester who treats Acceptance as the oracle can pass a deferred-then-adopted remint and fail a correct r4 owner. Align Acceptance with D5: mid-entry remints rebind and drop rule-3 adoption; initiating-context `currentPrincipal` is single-exposure; participants and peer contexts follow unchanged 0059.

2. **MATERIAL · IN-DELTA — The r4 authority-source set is not closed over the settled states D5 can produce.**  
   Terminology now claims every settled state D1/D5 can produce has exactly one source among: fresh server-witnessed anonymous establishment, restored custody, explicit application sign-in, supervised development bootstrap, or advanced external adoption. D7’s `ready` arm then projects `authoritySource: AuthoritySource` without defining that type.  
   The same r4 D5 path lets a peer win the intermediate anonymous predecessor; the initiating owner “surfaces the typed entry diagnostic over **whatever authority 0059 settled**.” That can be a peer session. None of the five categories fit: it is not fresh-anonymous, not a custody restore, not this owner’s application entry, not supervised bootstrap, and not D5 rule 4’s “explicit advanced constructor or shell.”  
   The shipped owner invents a sixth value, `external-transition` (`packages/snapback-client/app-client.mjs` after the peer-displaced catch; `AuthBootstrapAuthoritySource` in `app-client.d.mts`; `app-client.test.mjs` peer-win case). Close the D7 union in this RFC and name that arm (or classify the peer-won session in the existing set without stretching rule 4).

3. **minor · IN-DELTA — Implementation record remaining-closure list is incomplete.**  
   The three Phase 2/3/4 tickets exist and match the remaining rollout. Two other open `issues/` tickets that bound r4 claims are omitted: `issues/shelved/20260815-llp-0258-rebind-0241-successor-proof.md` (D2’s 0241 successor proof is not on `AppBinding` today) and `issues/20260815-llp-0258-react-hooks-expo-integration-lanes.md` (still Open, though Phase 3 remainders and the record treat those lanes as landed in `b186296fd`). The capsule has no git object store, so the five SHAs could not be resolved here; product claims match the tree, and `0477fda40` appears as the full SHA in `tests/acceptance/maturity/media-collection-2026-08-15.introduction.json`.

4. **minor · IN-DELTA — D2’s “unchanged (or LLP 0241-compatible) bootstrap policy semantic identity” is looser than the rotation parenthetical.**  
   Rebind is allowed when policy identity is unchanged or 0241-compatible; refusal is listed only for custody grade, sessions posture, and admitted mechanisms (D2). `anonymousPublic` and `lifecycleProtocol` are also policy fields and enter `policyIdentity` in the shipped owner (`app-client.mjs`). Say whether those field changes are live-owner rotations or compatible rebinds. This is underspecification, not a bad rotation rule.

## Implementation-phase notes

- **D2 rebind vs LLP 0241.** The decision to require an 0241-backed successor proof is sound. The landed owner enforces the subset the binding can prove: unexpired supervised bindings, non-rewinding `issuedAt`, retired generation identities cannot return, policy identity must match (`assertCompatibleRebind` in `app-client.mjs`; comment on `SnapbackAppBindingV1` provenance). That is not an `ActivationCandidateV1` / predecessor / readiness receipt (LLP 0241 D4). Do not describe today’s remint as the 0241 proof; keep `issues/shelved/20260815-llp-0258-rebind-0241-successor-proof.md` on the remaining list.
- **D5 withhold vs LLP 0238 `refreshing`.** The RFC already allows `loading` during the span. The owner holds `refreshing` plus the predecessor principal across the intermediate sign-out (`__withholdCurrentPrincipalPublication` in `packages/snapback-client/index.mjs`). LLP 0238 D6’s `refreshing` means that predecessor remains usable under existing custody. After barrier sign-out it does not. Project `loading` after the intermediate successor settles, or amend 0238; do not leave a dead supervised user in a `refreshing` snapshot.
- **Facade vs low-level client.** `client.auth` is the 0238 vocabulary-only namespace (`SnapbackClientAuthNamespace` in `index.d.mts`; password-auth test). Owner gating lives on the facade (`enterWith`, `changePassword` not using `enterWith`). Underscored owner seams (`__withholdCurrentPrincipalPublication`, `__authLogoutExpectedCapture`, `__supervisedBootstrapHandshake`) sit on `SnapbackClient` but not on `client.auth`. Keep them off the public low-level surface.
- **Verified r4 claims.** Codegen skips guest/passkey and does not put recovery on the allowlist (`packages/snapback-codegen/index.mjs` `deriveApplicationAuthBootstrapV1`; `application-auth-bootstrap.test.mjs`). `anonymousPublic` is a derived summary only; the owner does not use it as an authorization gate. `changePassword` requires `authenticated` and is not an entry refusal. Mid-entry remints rebind without waiting for issuance; `__adoptSupervisedBootstrapAuthority` returns `{ status: 'dropped' }` while `entryInFlight`. First-party adapters address `(appId, storagePartition)` with a default-partition legacy encoding (`auth-custody-indexeddb.mjs`, `auth-custody-secure-store.mjs`, `auth-coordinator.mjs`). LLP 0214 §22, LLP 0252’s 2026-08-15 note, LLP 0253 Appendix A, and `familiar-dispositions.mjs` all default Familiar custody to `durable-required` and refuse `volatile-explicit`. D9 recovery rows and facade consume/rotate are still Phase 3 (`issues/20260815-llp-0258-phase-3-remainders.md`). Native `durable-required` stays refused until Phase 2 evidence (`resolveAppClientPlatform` in `packages/snapback-expo/provider.mjs`).

The Status flip to Accepted and the unreviewed-r4 / growth-budget notes are accurate as author actions; they are not design findings.

VERDICT: NOT READY
