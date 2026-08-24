# Zero-setup development auth profiles

**Status:** Open
**Systems:** Auth, Identity providers, Code generation, CLI, Expo, Hosted delivery
**Owner:** Unassigned
**Related:** LLP 0036, LLP 0151, LLP 0214, LLP 0258, Diary 0111

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
