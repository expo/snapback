# Diary 0071: browser auth recipe

**Date:** 2026-08-08
**Systems:** Snapback auth, browser custody, identity binding, Guide, Vite,
real-Chrome acceptance

## What I built

I built the smallest registered browser journey that feels like an
application sign-in rather than a test-persona selector. A trusted local server
receives a one-use callback code from a hermetic signed-assertion fixture,
verifies issuer/audience/nonce/expiry, maps immutable issuer + subject to an
app-owned user, and binds the server-minted Snapback principal before the page
can receive a credential.

The page never adopts a raw broker bearer. The trusted server stages an
ordinary email-code challenge from the local capture mailbox, and the browser
calls `authExchange` so `AuthCoordinator` owns the bearer in the shipped
IndexedDB/Web Locks adapter. The real-Chrome acceptance then reloads the full
page without a second exchange, holds logout at the gateway to prove the UI is
already blank, releases revocation, and reloads signed out.

## What felt good

- The session provider already supplied the hard state machine. Once the
  browser entered through `authExchange`, reload and logout used the same
  coordinator path as ordinary email-code auth; no app-owned bearer store was
  needed.
- `createIndexedDbAuthCustodyStorage()` was a one-line carrier choice. The
  adapter's existing Web Locks/fenced fallback work meant the demo did not
  invent browser locking.
- `ctx.auth.userId` made the protected query clean: it has no identity
  arguments, and changing to a second subject visibly produced only that
  subject's private row.
- The default Vite relay's explicit system-route boundary was conceptually
  useful, but this recipe needed a narrower per-function allowlist. Writing the
  small exact gateway made the privileged omission mechanically testable.

## What felt hard or surprising

- The external-bearer seam and browser `AuthCoordinator` seam are distinct.
  `createExternalSessionClient` is correct for a headless/native bearer, but it
  does not make the same bearer durable browser coordinator custody. The
  server-side one-use challenge bridge is the strongest composition available
  without inventing a new adoption API.
- A Snapback handler cannot verify an app-supplied issuer or subject from
  `ctx.auth`; it sees the resolved principal only. That makes per-function
  gateway omission load-bearing for the binder. This friction is now recorded
  as an intentionally still-open platform issue, not hidden in the recipe.
- A sessions startup-artifacts carrier does not install the illustrative seed.
  The witness needed a closed private setup mutation before binding. It is
  safe for this fixture because the operation takes no user selector and is
  omitted from the browser gateway, but a platform provisioning channel would
  be cleaner.
- The first live run used a qualified binary from a different checkout. The
  client correctly rejected its mismatched auth-v1 handshake. Running
  `scripts/bootstrap-ibex-runtime` produced a branch-matched qualified binary;
  the unchanged witness then passed.
- A whole-worktree `node_modules` symlink made codegen resolve local packages
  outside the worktree and fail closed. A frozen install restored local package
  provenance.

## Comparison

Compared with Supabase Auth or Clerk, Snapback currently asks the application
to compose more of the identity-provider and app-user binding seam. The upside
is unusually explicit custody and authority: the browser cannot quietly claim
an app user, and the reload/logout barriers are testable protocol behavior.
The downside is that verified external claims and privileged binding are not
yet a first-class platform surface, and production delivery/hosted auth remain
real gaps rather than configuration steps.

Compared with Convex plus an external auth provider, the protected handler
shape is familiar — derive the authenticated subject server-side, never accept
an owner argument — but the current Snapback principal-to-existing-user join
needs more trusted-server plumbing.

## Boundary and follow-up

The fixture is deliberately not called OIDC. Draft LLP 0151 requires discovery
and JWKS behavior, PKCE/state/mix-up defense, sender-constrained completion,
provider-owned config/secrets, adversarial fixtures, lifecycle rules, and both
deployment arms. It also chooses app-owned provider credentials rather than a
shared production broker. This demo is evidence for the authoring composition,
not evidence that those product contracts exist.

The IndexedDB Guide gap is closed by the executable reload witness. The
principal-binding ticket remains open for the platform decision: verified
claims in handler authority versus a declared privileged provisioning channel.
