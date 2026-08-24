# Zero-setup development auth profiles

**Status:** Open
**Systems:** Auth, Identity providers, Code generation, CLI, Expo, Hosted delivery
**Owner:** Unassigned
**Related:** LLP 0036, LLP 0151, LLP 0214, LLP 0258, Diary 0104

## Demo checkpoint, 2026-08-21

Knockoff now implements the provider-entry resolver, no-runtime-fallback
controller, native-build probes, shared browser transaction, exact return
allowlist, client-held verifier, one-use redemption, replay refusal, app-scoped
rehearsal identities, and the 100-user limit. Apple uses its native SDK after
readiness. Google uses `@react-native-google-signin/google-signin` after
readiness.

The local shared Adapter uses hermetic identities. The product work remains
open because Snapback-owned provider registrations, the public callback host,
generated bootstrap policy, hosted rehearsal authority, production admission,
and setup commands do not exist yet.

## First-party checkpoint, 2026-08-24

The demo behavior above is now first-party surface, and several of the
acceptance criteria at the bottom of this ticket are met. What landed:

- **Generated bootstrap policy exists.** `defineAuth` types Apple/Google
  declarations with `credentials: 'auto' | 'shared' | 'app-owned'`, and the
  generated `ApplicationAuthBootstrapV1` projects them credential-free.
- **One resolver, one frozen Adapter, one stable call.**
  `@expo/snapback-client/provider-entry` plus
  `auth.signIn({ provider })` on the existing application auth owner.
- **Setup commands exist.** `snapback auth enable | configure | status`.
- **`snapback dev` supervises the shared broker** on the origin the client
  already discovers, with return targets derived from the supervised client
  port — so a fresh Expo app signs in with no second terminal, no broker
  origin, no `EXPO_PUBLIC_*` variable, and **no app-owned native build**.

Criteria now met, with proof: distinct app-scoped rehearsal identities per app;
callback refusal for an unregistered app binding, an arbitrary return URL, a
replayed code, and a missing verifier; no provider token or session credential
in a redirect URL, log, generated artifact, or receipt; typed settlement inside
a declared deadline; and a staging/production refusal of any shared profile.

**Still open, and the reason this ticket stays open:** Snapback-owned provider
registrations and the public callback host. Until those exist the shared
Adapter issues hermetic rehearsal identities, so "signs in through both
providers" is true only in the rehearsal sense. Hosted rehearsal authority is
also still absent — the broker is supervised locally by `snapback dev`.

One criterion landed differently than written. "Replacing the profile stores
credentials only in LLP 0036 deployment state" is met for *secrets*:
`snapback auth configure` refuses a secret value and prints the exact
`snapback config set --value-stdin` command. Public identifiers land in a
tracked `snapback/auth-providers.json` instead, on the reasoning that public
identifiers belong to the app and want to be reviewable while secrets must
never be diffable. Recorded as a scoped divergence in LLP 0151's 2026-08-24
amendment; whether the public half should also move into LLP 0036 entries is
open.

## Problem

A new app can declare Apple or Google login, but the first real run stops at
provider registration and credential setup. The hermetic fixture proves the
Snapback session path, yet it is not the experience an app author expects from
a first-party auth profile.

## Author ruling

First-party providers use Snapback-owned shared credentials by default in
development. The app replaces those credentials with app-owned provider
registrations before staging or production.

The development profile creates app-scoped rehearsal identities. Rehearsal
identities cannot enter staging or production and do not migrate implicitly to
an app-owned provider installation.

## Interface

The authored declaration names the provider once and selects credentials with
`auto`:

```ts
providers: {
  apple: { kind: 'apple', credentials: 'auto' },
  google: { kind: 'oidc', preset: 'google', credentials: 'auto' },
}
```

Codegen resolves `auto` against the deployment profile. Local development uses
the shared broker, tests use the synthetic IdP, and production requires LLP
0036 app-owned config.

## Required work

1. Extend `defineAuth` and generated bootstrap policy with the provider preset,
   credential-selection mode, and rehearsal disposition.
2. Specify and implement the shared development broker. Use the existing LLP
   0151 completion protocol, app binding, one-use code, and client-held verifier.
3. Add provider registrations for Apple, Google, GitHub, and Expo as each
   adapter reaches tier 1. Native apps use the browser flow under shared
   credentials.
4. Resolve the development broker through `snapback dev` and the first-party
   client bootstrap. App code must not start or configure another broker.
5. Add the setup transition that writes app-owned ids and secrets into LLP 0036
   deployment state and verifies each callback.
6. Refuse staging and production activation if a shared profile resolves, a
   rehearsal identity remains, or required app-owned config is unset.
7. Add a deadline and a typed stage diagnostic to every provider completion
   wait. No provider failure may leave sign-in UI pending forever.

## Acceptance

- A fresh Expo app declares Apple and Google, runs `snapback dev --expo`, and
  signs in through both providers without provider-console setup.
- Two apps signing in through the same shared provider receive different
  app-scoped rehearsal identities.
- The callback rejects an unregistered app binding, an arbitrary return URL, a
  replayed completion code, and a missing redemption verifier.
- Provider tokens and Snapback session credentials never appear in redirect
  URLs, logs, generated artifacts, or receipts.
- A stalled provider, broker, session exchange, or provisioning hook settles as
  a typed error within its declared deadline.
- A production start with any shared profile or rehearsal identity refuses
  before serving app traffic.
- Replacing the profile stores credentials only in LLP 0036 deployment state.
  The app source and generated client bundle contain public provider metadata
  only.
