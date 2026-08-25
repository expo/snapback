# Supervised Expo web omits `EXPO_PUBLIC_SNAPBACK_URL` and mints a session that hides password UI

**Filed:** 2026-08-25
**Source:** Clique grok-4.6 xhigh published 0.1.27, lane `grok-clique-familiar`
**Systems:** React/Expo, Auth, CLI, Guide
**Owner:** LLP 0310.000 Track B

## Problem

`snapback dev --expo --expo-platform web` injects
`EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` and mints an ambient session. It
does not inject `EXPO_PUBLIC_SNAPBACK_URL`. Adopting the mint hid
`sm-auth-email`. Signing it out crashed the provider with
`SNAPBACK_AUTH_SESSION_EXPIRED`. The working landing was URL-first
`SnapbackProvider` using the supervisor bootstrap origin and ignoring the
minted bearer. That reconstructs LLP 0300 by hand. The familiar page does
not say so.

## Evidence

- Familiar diary M1 and essay
  (`benchmarks/runs/2026-08-25-clique-grok-0127/cells/grok-clique-familiar/`)
- LLP 0310 F3 / P4

## Direction

Preferred: also inject `EXPO_PUBLIC_SNAPBACK_URL` so password signup/sign-in
work without adopting the mint. The mint stays an explicit opt-in
(LLP 0258 / 0262), not the default first session. A sign-out of a session
the author never created must not be the only path back to a login form.

## Resolution (2026-08-25)

Implemented LLP 0310.000 Track B (in review).

- Supervised Expo web now gives Metro `EXPO_PUBLIC_SNAPBACK_URL` equal to the
  admitted backend data/auth origin. The supervisor origin remains the
  credential-free control-plane rendezvous and the selected binding source.
- The ordinary bootstrap exchange returns the binding with authority
  `unavailable`, including after another client has minted. Explicit adoption
  is a capability-bearing POST from an exact admitted origin; every accepted
  request receives a fresh session, and the first mint does not emit
  `authority-replaced`.
- The default supervised-web provider stays anonymous and its password form
  remains visible. A real `SnapbackExpoProvider` React tree with a mounted
  query also proves that explicitly adopting a mint and signing it out leaves
  the query auth-blocked and the password form visible without publishing
  `SNAPBACK_AUTH_SESSION_EXPIRED`; the fake server records the logout revocation
  and would reject any later reuse of that bearer.
- On the real supervisor, the first-party provider retains the supervisor
  rendezvous as its binding source, and that admitted binding's target origin
  exactly equals Metro's injected `EXPO_PUBLIC_SNAPBACK_URL`. The original
  supervisor cache makes the second explicit
  adoption after sign-out fail with `SNAPBACK_AUTH_SESSION_EXPIRED`; the fixed
  supervisor remints and that adoption succeeds.
- Backend URL injection is limited to web. Native supervision remains
  sessions-first at the provider boundary, but now mints its one initial
  session on the default adoption request instead of eagerly creating and
  leaking an unused predecessor. The checkout regression also proves that the
  native nonce is stripped from Metro and every `EXPO_PUBLIC_*` value.
- LLP 0300 P4, the Familiar profile page, the React Expo guide, and the
  `expo-chat` start packet now describe this posture. Generated diagnostics,
  symbol, manifest, flat-guide, and first-read projections were refreshed.

The regression was demonstrated before the fix. The URL checkout assertion
failed with:

```text
AssertionError [ERR_ASSERTION]: supervised web exposes the backend data/auth origin separately from the control plane
+ actual - expected
+ undefined
- 'http://127.0.0.1:4287'
```

The real web slice then exposed the same missing projection:

```text
AssertionError [ERR_ASSERTION]
+ backendOrigin: null
- backendOrigin: 'http://127.0.0.1:4287'
```

With a qualified real server present, the uncorrected boot-eager expectation
failed at `packages/snapback-cli/expo-dev-loop.test.mjs:950`:

```text
AssertionError [ERR_ASSERTION]
+ actual - expected
+ 'authority-required'
- 'ready'
```

The complete real-server `expo-dev-loop` file now passes with the supplied
qualified binary, including anonymous password signup/sign-in, explicit mint
adoption, safe sign-out, remint after revocation, ordinary-route bearer
secrecy, URL/control-plane separation, generated-graph freshness, and strict
cleanup. The focused bootstrap, provider, supervised-environment, identity
checkout, guide, and inventory checks pass as well. The initial branch failed
`ref-check` because its base omitted LLP 0310/0310.000; the byte-identical
documents and current links were imported from `origin/main`, after which the
reference check passed.
