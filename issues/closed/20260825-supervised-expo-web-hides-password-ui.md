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
  `unavailable`. Only the explicit authority request mints; first-party Expo
  boot adopts it only with `adoptSupervisedSession: true`.
- The default first-party provider stays anonymous and its existing password
  signup/sign-in owner remains usable. Explicit mint adoption still works,
  and signing that session out leaves the provider `ready` and anonymous
  without publishing `SNAPBACK_AUTH_SESSION_EXPIRED`.
- No native-only mint invariant collision was found: backend URL injection is
  limited to the web Metro arm, while the checkout regression proves the
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

After URL injection alone, the new anonymous-first assertion exposed the
remaining boot-eager mint:

```text
AssertionError [ERR_ASSERTION]
+ actual - expected
+ 'authority-required'
- 'ready'
```

Passing focused evidence proves the binding-only versus explicit-authority
request split, default anonymous/password entry without supervisor adoption,
explicit mint adoption, safe sign-out, web URL/control-plane separation,
nonce secrecy, and Metro generated-graph freshness. The full real-server
`expo-dev-loop` Track B block contains the combined signup/sign-in and sign-out
assertions, but could not be rerun after the supplied checkout-local qualified
binary symlink became broken; this resolution does not claim that missing
real-runtime execution.
