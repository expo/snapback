# First-class React-provider optimistic create remains missing

**Status:** Resolved 2026-08-10
**Date:** 2026-08-08
**Severity:** P3
**Systems:** React client, Optimistic mutation view, Generated IDs
**Governing:** LLP 0107, LLP 0133, LLP 0155

## Problem

The shipped generated-IR path can optimistically create a server-ID row with
durable intent, typed provisional presentation, logical-mint reconciliation,
restart replay, and ambiguous-retry idempotence. Its public seam is
`SnapbackClient.createOptimisticMutationView`, however, so React applications
must compose the view, canonical live handles, rebase, projection, and teardown
directly.

`useSnapbackMutation` still projects only over an existing canonical query
result. There is no provider-owned API that inserts a typed provisional entity
directly into a canonical `useSnapbackQuery` store. The simple hook-native
alternative remains a component-local pending sidecar, which cannot
participate in query filtering, ordering, counts, or relationships.

## Desired result

Design a first-class React surface over the shipped substrate without changing
LLP 0133 settlement identity:

- provisional identity is a distinct generated type and cannot flow where
  `Id<Table>` is required;
- one authored generated mutation drives local prediction and server
  authority;
- provider query projection includes provisional rows under explicit
  filter/order/count/relationship semantics;
- rejection retires only its layer, and success bridges until authoritative
  delivery maps the logical mint;
- response-loss replay preserves one intent/one canonical row;
- the paved insert shape does not trigger the generic append-reducer replay
  advisory; and
- authority partition, Strict Mode/HMR sharing, and cleanup remain owned by
  the provider.

## Acceptance

- A generated-type fixture proves no canonical-id forgery or casts.
- React tests cover response-before-query, query-before-response, rejection,
  overlapping creates, authority cut, Strict Mode remount, and cleanup.
- A served acceptance drops the response after commit, replays the exact
  `clientMutationId`, consumes the same `idMap`, and renders one canonical row.
- `clients.optimistic-create` advances from GAP only after this exact provider
  surface and evidence land.

The current executable lower-level recipe is
`guide/recipes/optimistic-create.md`; do not duplicate its settlement
machinery in this issue.

## Resolution

Shipped `useSnapbackOptimisticCreate` and
`observeSnapbackOptimisticCreate` in `@expo/snapback-react`. One
provider-owned headless view now projects generated single-`Insert` layers
over the exact canonical query store. Generated clients export a distinct
`ProvisionalId<Table>`; the public entity union keeps the speculative mint and
server-authored metadata private until LLP 0133 `idMap` settlement.

`packages/snapback-react/optimistic-create.test.mjs` covers typed projection,
explicit filter/order/relation semantics, both response/query orderings,
overlapping rejection, authority replacement, Strict Mode remount, replay
recovery, and cleanup. The existing real-server
`provider-live-conformance` gate now drops a response after commit, replays the
same `clientMutationId`, observes the same `idMap`, and renders one canonical
row. `clients.optimistic-create` is consequently `local / shipped`.
