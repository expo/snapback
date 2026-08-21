# Make fixed-origin external clients a first-party development lifecycle

**Status:** Open
**Opened:** 2026-08-21
**Systems:** CLI, Local server lifecycle, Expo, Vite/Exact, Headless client,
Sessions auth, Verification
**Governing:** LLP 0295 D0.1/W1; LLP 0223; LLP 0261
**Related:** `issues/20260818-guide-gap-fixed-origin-dev-attach-recipe.md`;
`issues/20260819-expo-web-carrier-supervised-origin.md`;
`issues/20260820-vite-password-auth-relay-allowlist.md`

## Problem

The ordinary supervised Expo path and a caller-pinned external-client path do
not share one lifecycle. Fixed benchmark/Vite origins push authors down to
`snapback start --startup-artifacts`, handwritten binding environments,
wrappers that happen to occupy the requested port, and manual Expo startup.
Regeneration then risks tearing down sessions or requiring a destructive
reseed. The Guide can document today's composition, but documentation alone
cannot supply one lifecycle owner or an authoritative ready receipt.

## Decision gate

Record D0.1's semantic lifecycle in LLP 0223/0261 before expanding CLI syntax.
The default proposal is a fixed-origin/external-client profile of `snapback
dev`; if the owning design selects a lower-level shared primitive instead, this
ticket follows that ruling rather than preserving the proposed command shape.

The ruling must cover selected and pinned ports, fresh start and attach,
regeneration and additive schema succession, sessions deployment/store
identity, binding admission, cleanup, and a ready receipt naming the runtime,
app artifact, binding, authority mode, and client origin.

## Implementation scope after the ruling

- Give Expo, Vite/Exact, headless, and acceptance consumers the same structured
  readiness and attachment facts without parsing logs.
- Treat an already-running intended child differently from an unrelated stale
  listener; never accept port occupancy as identity.
- Preserve accounts, custody, deployment identity, and application data across
  one additive M1 -> M2 schema change.
- Delete benchmark/template-owned startup-carrier wrappers and handwritten
  binding environments once the product path carries their facts.
- Keep `start --startup-artifacts` available as a diagnostic primitive rather
  than presenting it as the competing golden path.

## Acceptance

Fresh packed-package Expo, Vite/Exact, and headless fixtures attach through the
ruled lifecycle, reach application-ready state, perform an additive schema
successor with the original accounts and sessions intact, and shut down only
their owned children. They use no custom relay/binding middleware, destructive
reseed, or source-checkout-only helper. A stale listener and a wrong binding
both refuse with stable identity-bearing diagnostics.
