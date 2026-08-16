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
