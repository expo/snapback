# LLP 0258 React/Expo projection (b186296fd) landed-code review — grok

**Reviewer:** grok CLI, grok-4.6, xhigh, read-only charter
**Date:** 2026-08-15
**Subject:** same as the codex artifact
**Verdict as received (READY with 2 MINORs; the codex MATERIALs in classes grok passed as clean were verified real by the fix lane — same asymmetry as the Phase 1 core review):**

I'll review the landed LLP 0258 projection as it stands at HEAD: first the governing LLP constraints, then the React/Expo surfaces and the eight defect classes.LLP 0253 isn’t at the expected path — I’ll locate S6.1 and read the governing decision sections next.Next I’ll read S6.1, the amended 0181 Provider section, and the React/Expo implementation at HEAD.I’ll read the React/Expo implementations and the two follow-up commits that already landed on top.The React kernel is large — I’ll jump to the provider, principal hook, and cache-key paths next.`implementation.mjs` has a null byte, so I’ll extract the auth-hook and provider sections with a text-safe search.I’ll inspect snapshot identity, `currentPrincipal`, supervised adoption, and the remaining app-client construction path.I’ll read the handshake, `clearAuthSession`, Expo types, and the two follow-up commits next.I’ll pull the discarded React-lane review and the Phase 1 artifacts so I can map those defect classes onto the landed code.READY

Reviewed the React/Expo projection at current HEAD (b186296fd plus 699b7f907 and 8c79faccd). Official ordinary/Expo pairing, D5 precedence, D7 boot union, legacy opt-in gate, and `useSyncExternalStore` principal projection hold. Two MINOR residues remain; they do not break the specified ordinary path.

1. **MINOR** — class 1: `getServerSnapshot` is the live principal snapshot; no test hydrates.

`useSnapbackCurrentPrincipal` passes the same callback as `getSnapshot` and `getServerSnapshot` (`packages/snapback-react/implementation.mjs:4211-4218`). That callback returns `auth.currentPrincipal()`, which is the client’s cached frozen object (`packages/snapback-client/index.mjs:2948`, `#commitCurrentPrincipalSnapshot` at `3003-3008`). Identity is stable for a given publication, so this is not the “new `{status:'loading'}` every call” infinite-loop form.

Official trees still never SSR the hook: `OrdinarySnapbackProvider` and `SnapbackExpoProvider` keep children off the tree until a client-only `useEffect` publishes `ready` (`implementation.mjs:4094-4109`, `provider.mjs:606-638`). `auth-bootstrap.test.mjs` uses `TestRenderer.create` only (`243-251`); nothing calls `hydrate` / `hydrateRoot`.

**Failure scenario:** an app SSRs a tree that already has `__appClientProjection` (or a custom `appClientContext`) while the server client is anonymous and the hydrating client restored a durable session. React compares the live server snapshot to the live client snapshot and throws a hydration mismatch. The official providers do not take that path today.

2. **MINOR** — class 2: same-instance documented mix is refused; pairing identity is not.

`providerOwnershipMode` throws `SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID` before render for `appClient`+`app`, `appClient`+`binding`/`provider`, and `app`+`provider` (`implementation.mjs:4113-4145`; covered at `auth-bootstrap.test.mjs:279-286`). That is D7’s duplicate-owner class for one instance.

`__appClientProjection !== undefined` short-circuits that check and installs context with no identity test against `provider.binding`’s client (`implementation.mjs:4148-4154`, `4166-4171`). Expo always takes that backdoor (`provider.mjs:632-638`), including the legacy path where `appClient` is `null` (`null !== undefined`). A nested advanced `SnapbackProvider` does not overwrite context, so `useSnapbackAppClient` keeps walking to the parent (`implementation.mjs:4197-4205`).

**Failure scenario:** `<SnapbackProvider appClient={clientA}><SnapbackProvider provider={providerBuiltFromClientB}><LiveList /><WhoAmI /></SnapbackProvider></SnapbackProvider>`. `useSnapbackQuery` talks to B; `useSnapbackCurrentPrincipal` talks to A; no diagnostic. If `WhoAmI` is omitted, A still sits in context as a dead mismatched owner for the whole subtree.

---

**CLEAN classes**

3. **Hook caches / ownership mode.** No hook-level principal cache. The hook subscribes to `auth` identity (`implementation.mjs:4211-4226`). Ordinary vs advanced is a different component (`OrdinarySnapbackProvider` vs `AdvancedSnapback*`). Familiar aliases are the same functions (`familiar.mjs:24-30`, `familiar.test.mjs:506-507`). Switching `app` / `appClient` / `binding` / `platform` / `storagePartition` rebuilds the controller (`implementation.mjs:4010-4016`).

4. **`useSyncExternalStore` discipline.** Snapshot identity is the cached frozen principal (`index.mjs:3003-3008`). Subscribe matches LLP 0238 D3: one microtask, no sync listener, idempotent unsubscribe (`index.mjs:2967-2994`). Unmount drops the facade subscription (`app-client.mjs:859-866`). Client/provider swap changes `auth` and resubscribes. `clearAuthSession` publishes `LOADING_CURRENT_PRINCIPAL` (`index.mjs:3610-3619`); the React test follows it to `loading` then `blocked` (`auth-bootstrap.test.mjs:336-346`). Withhold → `refreshing` is also covered (`301-311`). The registry is an auth-barrier participant, including presence (`implementation.mjs:2933-2983`).

5. **Supervised precedence (D5 / 0181).** Ordinary path never calls `createExternalSessionClient` / `replaceBearerToken`. Adoption is `adoptSupervisedBootstrapAuthority` → `__supervisedBootstrapHandshake` (`app-client.mjs:1053-1090`, `index.mjs:4270-4323`). Session predecessor + different user → `conflict` + `SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT` ready advisory, no bearer swap. Same authority → `compareAndRotateBearer` (`rebound`). Anonymous/fresh → coordinator `transition` (`adopted`). Mid-entry remints return `dropped`. Expo boot/refresh only call `adoptSupervisedAuthority` (`provider.mjs:327-332`, `488-493`). Covered by `provider-auth-bootstrap.test.mjs:271-322`.

6. **Boot-state union.** First-party observer publishes `binding | custody | authority | client` and skips owner `ready` until Expo adds binding + preparation (`provider.mjs:226-237`, `290-291`, `361-365`; stages asserted at test `282-286`). `ready` may be anonymous; `authority-required` is only the Sessions mint refusal (`SNAPBACK_AUTH_POLICY_UNAVAILABLE`, `313-325`). Missing mint is `unavailable` and does not fail boot (`supervised-environment.mjs:369-376`). `blocked` comes from custody/authority construction failures (`app-client.mjs:461-470`). Legacy ready still has `authority`, not `advisories` (`provider.mjs:440-445`).

7. **Legacy byte-compat.** Opt-in is `authBootstrap.format === snapback.application-auth-bootstrap.v1` **and** `auth.application-bootstrap.v1` in `capabilities.required` (`provider.mjs:75-82`). Generated Sessions apps have the fact but not the capability (conversation fixture, field-notebook). `provider.test.mjs` still drives `adoptAuthority` and the old `authority-required` contract. `adoptAuthority` / `refreshAuthority` on `createSupervisedExpoEnvironment` still use `createExternalSessionClient` / `replaceBearerToken` (`supervised-environment.mjs:400-526`). The first-party branch returns before that path.

8. **Disposal / Fast Refresh.** `disposed` is set before `cleanup` (`provider.mjs:566-571`). After `createApplicationClient` and supervised adopt, a mid-await unmount disposes the projection (`294-336`). `OWNER_REGISTRY` waits through `disposing` and refcounts projections (`app-client.mjs:942-967`, `983-1032`). Ordinary React uses a generation token + replay-window dispose (`implementation.mjs:3967-3983`). StrictMode is exercised (`auth-bootstrap.test.mjs:243-251`). Expo effect `void boot.dispose()` is fire-and-forget (`provider.mjs:621-625`) but the owner registry serializes the successor boot.

9. **Secret hygiene.** Ready/advisory/boot facts have no bearer (`app-client.mjs:485-522`, `provider.mjs:226-237`). `publicBindingFacts` keeps only `integrity.channel` (`app-binding.mjs:539-546`). Conflict details are `appId`, principal status, `supervisedUserId`. `signIn`/`signUp` results drop `token` (`auth-bootstrap.test.mjs:297-298`, `329-330`). Recovery codes stay on the D8 return boundary. `resolveSupervisedAuthority` returns the bearer only on the internal environment seam, then deletes the exchange (`supervised-environment.mjs:389-398`). Production builds empty `SUPERVISED_EXCHANGE_PATH` (`supervised-environment.mjs:11-18`).
