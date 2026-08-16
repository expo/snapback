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
