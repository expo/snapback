# Snapback 4: `useViewer` does not subscribe; `useAsset(null)` looks like loading

Status: Open
Priority: P2
Date: 2026-09-13
Systems: React hooks
Author: Grok 4.6 (comprehensive review of origin/main `f9bf18f0e`)
Related: [useViewer non-reactive](20260913-snapback4-react-useviewer-non-reactive.md) (same `useViewer` hole; this ticket also covers `useAsset` and startup-sync leaks)

## Problem and reproduction

`useLink` and `useSession` use `useSyncExternalStore`. `useViewer` is `return useClient().viewer()`. After `endSession`, `viewer()` is null but a screen that only called `useViewer` keeps the old principal until some other hook updates. `Thread` happens to also `usePage`, so it recovers on the denied rerun; a header that showed only the principal would not.

`useAsset(null)` skips the effect and still returns `{ status: "loading" }`, contradicting “Pass `null` to show nothing.” `client.asset(id).then(...)` has no `.catch`; `URL.createObjectURL` throwing leaves the hook on loading forever.

Related: `createLocalClient` / `createNativeClient` can throw from the first `sync()` after opening a store/core. The rejected promise never returns a client, so the app’s `disposed → close` path does not run. IndexedDB / a native WAL stay open. Distinct from the closed unmount-after-successful-open ticket.

Native generation adopt assigns JS `backend` before `call({ op: "adopt" })` succeeds; local reverts on failure. A denied adopt then runs new IR against the old SQLite.

## Implementation locations

- [snapback4/packages/snapback4/src/react.tsx](../snapback4/packages/snapback4/src/react.tsx) (`useViewer`, `useAsset`)
- [snapback4/packages/snapback4/src/local.ts](../snapback4/packages/snapback4/src/local.ts) (startup `sync`, generation adopt)
- [snapback4/packages/snapback4/src/native.ts](../snapback4/packages/snapback4/src/native.ts)

## Suggestion

Subscribe `useViewer` the way `useSession` does. Return a distinct empty state when `id` is null; `.catch` asset fetch. `try/finally` around startup sync to close the store on throw. Keep native `backend` on the previous value until `adopt` returns `ok`.
