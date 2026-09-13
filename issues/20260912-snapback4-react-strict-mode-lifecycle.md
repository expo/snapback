# Snapback 4: Make React hook resources survive Strict Mode setup and cleanup

Status: Open
Priority: P2
Observed: 2026-09-12
Review finding: R28
Evidence: Reproduced in headless Chromium with the installed React development build
Baseline: `d6c803878a5432cce5f045777786a049972d3d70` / Snapback 4 0.0.16
Related: [LLP 3000.001](../llp/3000.001-durable-replica-and-write-lifecycle.research.md), [comprehensive review](../llp/reviews/3000-architecture-code-review-20260912.md)

## Problem and reproduction

`useMutation` initializes `alive` to true once and only sets it false in effect
cleanup. Strict Mode's cleanup/setup cycle leaves it false permanently, so a
successful mutation never updates `last` or clears `inFlight`. `usePage`
creates and subscribes a `Pages` resource inside `useMemo`; a discarded render
leaks that resource, while effect replay closes the retained one.

The actual hooks were mounted under `StrictMode` with a controlled client.
After a mutation resolved `sent`, hook state was `{last: undefined,
inFlight: true}`. After unmount, two page resources had been opened and one
remained unclosed; the other had received cleanup twice.

Make resource acquisition/disposal match committed effect/subscription
lifetimes, with idempotent cleanup and valid setup after replay. Reset the
mutation liveness state during setup, and handle thrown client/storage errors
so `inFlight` cannot remain stuck. Cover `useQuery` as well as `usePage`,
argument changes, unmount during an operation and Strict Mode replay with real
React. Do not rely on reference apps omitting Strict Mode.

## Implementation locations

- [packages/snapback4/src/react.tsx](../snapback4/packages/snapback4/src/react.tsx)
