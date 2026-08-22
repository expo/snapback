# Make fixed-origin external clients a first-party development lifecycle

**Status:** Closed
**Opened:** 2026-08-21
**Closed:** 2026-08-21
**Systems:** CLI, Local server lifecycle, Expo, Vite/Exact, Headless client,
Sessions auth, Verification
**Governing:** LLP 0295 D0.1/W1; LLP 0223; LLP 0261
**Related:** `issues/20260818-guide-gap-fixed-origin-dev-attach-recipe.md`;
`issues/20260819-expo-web-carrier-supervised-origin.md`;
`issues/closed/20260820-vite-password-auth-relay-allowlist.md`

## Problem

The ordinary supervised Expo path and a caller-pinned external-client path do
not share one lifecycle. Fixed benchmark/Vite origins push authors down to
`snapback start --startup-artifacts`, handwritten binding environments,
wrappers that happen to occupy the requested port, and manual Expo startup.
Regeneration then risks tearing down sessions or requiring a destructive
reseed. The Guide can document today's composition, but documentation alone
cannot supply one lifecycle owner or an authoritative ready receipt.

## Decision gate — RESOLVED 2026-08-21

The D0.1 ruling is recorded in **LLP 0223, dated amendment 2026-08-21**
(with the composition binding in LLP 0261's same-day amendment), **adopted
per LLP 0295's default proposal; the author may revise**. Decided contract,
in brief:

- `snapback dev` is the single lifecycle owner for all client stacks and
  gains a fixed-port/external-client profile; `start --startup-artifacts`
  and hand-written environment objects are diagnostic primitives only.
- Tool-selected ports by default; caller-pinned port plus declared external
  client origin in the fixed profile. Port occupancy is never identity —
  attach verifies receipt identity or refuses with a stable diagnostic.
- One verb set: fresh start, attach (idempotent, intended-child vs stale
  listener distinguished), regenerate with owner-performed carrier rewrite,
  additive schema successor, shutdown of owned children only.
- Accounts, custody, sessions, and application data survive regenerate and
  additive succession; per LLP 0058 the complete active deployment identity
  **advances** on successor activation, with the old and new identities
  reported — continuity and lineage are preserved, never identity equality.
  Destructive reseed is never implicit.
- The fixed profile issues a real admitted binding (rendezvous or admission
  handshake against the pinned origin); a caller override is never laundered
  as a supervisor exchange. Declared-external clients are neither launched
  nor torn down (retires the `SNAPBACK_EXPO_LISTENER_ENUMERATION_INCOMPLETE`
  class for declared clients).
- The authoritative ready receipt is **`snapback.application-ready.v1`**
  (LLP 0224), extended with binding, client origin(s), and
  qualified-binary-vs-wrapper identity — all three on the receipt itself
  (the extension amends LLP 0224 and its closed schema as W1
  follow-through); the `HostReadyDescriptor`
  (`--ready-file`) stays host-only and locates it; the supervisor stream
  stays events; `expo-supervisor.json`/`connectCarrier` become projections.
  All consumers read the receipt, none parses logs.
- LLP 0295 OQ1 answered: mode of `snapback dev` at the product surface;
  internal engine factoring allowed, no second public lifecycle command
  (re-open trigger recorded in LLP 0223).

## W1 implementation checklist (after the ruling)

- [x] Extend `snapback dev` with the fixed-port/external-client profile
      (pinned port, declared client origin, derived relay/CORS allowlist).
- [x] Implement receipt-verified attach; typed refusals for stale listener
      and wrong binding; never adopt or kill an unverified listener.
- [x] Extend `snapback.application-ready.v1` with binding, client
      origin(s), and qualified-binary identity; make `expo-supervisor.json`
      and `connectCarrier` projections of it, keeping their
      transience/permissions.
- [x] Owner-performed startup-carrier rewrite on regenerate (hot-load
      without restarting the pinned server or the external client).
- [x] Preserve accounts, sessions, and stores across regenerate and one
      additive schema successor with the LLP 0058 identity advance reported
      (old/new pair asserted); make any destructive step explicit.
- [x] Packed-package acceptance fixtures: Expo, Vite/Exact, headless — each
      attaches, reaches ready, performs M1 -> M2 additive change with
      original accounts and sessions intact and the identity advance
      reported, shuts down owned children only.
- [x] Negative fixtures: stale listener on pinned port; caller-supplied
      binding override (refuses, names the supported profile).
- [x] Delete startup-carrier wrappers and handwritten binding environments
      from the four matrix lane templates (Clique/Coterie x
      Explicit/Familiar benchmark prompt/template fixtures); this is not a
      CLI `carrier.mjs` template sweep.
- [x] Re-document `start --startup-artifacts` as diagnostic-only; update the
      fixed-origin guide recipe ticket
      (`issues/20260818-guide-gap-fixed-origin-dev-attach-recipe.md`) to
      teach the profile once it ships.

## W1 implementation slice — 2026-08-21

This lane completed checklist items 1–5, 7, and 9 as one coherent lifecycle
slice. `snapback dev` now owns the fixed backend port, exact declared client
origin and derived development admission; attach validates the live host
nonce and the closed application receipt before touching the listener. The
receipt itself now carries the lifecycle-issued binding, exact client-origin
set, qualified binary digest/qualification and CLI wrapper package/version.
Expo and Vite project those facts rather than manufacturing a second binding.

The sessions loop now asserts an additive hot successor in the same backend
process, owner-rewritten startup carrier, surviving product row and durable
signed-in account/session, plus the reported old→new deployment identity and
continuity statement. Negative coverage includes an unrelated listener on the
pinned port and a caller-supplied Vite binding override; both refusals name the
supported fixed profile and leave existing ownership untouched.

The follow-through closes items 6 and 8 together. One external consumer
materializes packed CLI, client, Vite, and support-package tarballs, then proves
the headless, Vite/Exact, and Expo arms through M1→M2. Each arm preserves its
signed-in principal, session identifier, and application row while asserting
the reported old→new deployment identity and the receipt's continuity facts.
The attached Vite and Expo consumers close without stopping the lifecycle
owner; the owner then performs the one authorized shutdown.

The four Clique/Coterie × Explicit/Familiar matrix templates now name only the
ruled `snapback dev` lifecycle and authoritative application-ready receipt.
They contain no startup-carrier wrapper, handwritten binding environment,
custom relay, endpoint `.env`, or destructive reseed path. The packed fixture
is their package-bound replacement proof. The Bun-hosted Vite witness also
delegates isolated codegen to Node 24 while retaining lifecycle and relay
ownership in Bun, so the canonical lifecycle remains usable on that shipped
runtime boundary.

Resolution evidence: `packages/snapback-cli/packed-dev-lifecycle.test.mjs`,
`packages/snapback-vite/packed-password-relay.test.mjs`, and the four templates
under `benchmarks/runs/2026-08-17-model-profile-app-matrix/`.

## Implementation scope after the ruling

- Give Expo, Vite/Exact, headless, and acceptance consumers the same structured
  readiness and attachment facts without parsing logs.
- Treat an already-running intended child differently from an unrelated stale
  listener; never accept port occupancy as identity.
- Preserve accounts, custody, application data, and deployment lineage across
  one additive M1 -> M2 schema change (the deployment identity itself
  advances per LLP 0058, old/new reported).
- Delete benchmark/template-owned startup-carrier wrappers and handwritten
  binding environments once the product path carries their facts.
- Keep `start --startup-artifacts` available as a diagnostic primitive rather
  than presenting it as the competing golden path.

## Acceptance

Fresh packed-package Expo, Vite/Exact, and headless fixtures attach through the
ruled lifecycle, reach application-ready state, perform an additive schema
successor with the original accounts and sessions intact — asserting the
reported old -> new deployment-identity advance per LLP 0058, never identity
equality — and shut down only their owned children. They use no custom
relay/binding middleware, destructive reseed, or source-checkout-only helper.
A stale listener and a wrong binding both refuse with stable identity-bearing
diagnostics.
