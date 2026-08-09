# First-class React-provider optimistic create remains missing

**Status:** Open
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
