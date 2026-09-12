# Snapback 2 `useQuery` resubscribes when `options.items` is a new object

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-11
**Systems:** `snapback2/packages/snapback2/src/react-core.tsx` (`useQuery`, `usePage`)
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1002 §9; 256 live-shape cap; Clique per-row hook footgun

## Symptom

`useQuery` / `usePage` put `options.items` in the `useMemo` dependency list **by reference**. A module-level `defineItems` (chat `conversationItems`) is stable. An inline `{ items: defineItems(...) }` or a parent-allocated object recreates the observation every render: unsubscribe + resubscribe, a new multiplex child, and a StrictMode double-open.

That is the practical path back into the 256 cap and into reconnect flicker, even though identical `(op, args)` otherwise share a `SharedSubscriptions` entry. Crash-at-257 is gone (`E_OWNER_BUSY`); burning the budget every render is not.

`client-observed.ts` already has `declarationId` (a `WeakMap`) for history cores. `useQuery` does not use it.

## Evidence

```183:186:snapback2/packages/snapback2/src/react-core.tsx
  const observed = useMemo(
    () => client.observe(ref, stableArgs, { ...options } as ...),
    [client, snapshot.authGeneration, operation, argsKey, live, options.drain, options.items],
  );
```

## Proposed patch

Export `declarationId` from `client-observed.ts` (or duplicate the WeakMap in `react-core.tsx` if you do not want to export). Depend on the id, not the object.

```ts
  const itemsId = options.items ? declarationId(options.items) : 0;
  const observed = useMemo(
    () => client.observe(ref, stableArgs, { ...options } as { live?: false; drain?: boolean; items: Items<Args, Result, Row, Draft> }),
    [client, snapshot.authGeneration, operation, argsKey, live, options.drain, itemsId],
  );
```

Same change for `usePage`. Inline `{ items: defineItems(...) }` still allocates a new object each render, but `declarationId` is per object identity of the **declaration** `defineItems` returns if callers pass that stably. If they pass a new `defineItems(...)` each time, the WeakMap still assigns a new id — the remaining footgun is “do not call `defineItems` inside render,” which the guide should say.

Better: `defineItems` returns a frozen object with a stable id, and the hook keys on that.

## Acceptance

- A parent that passes a module-level `items` declaration does not unsubscribe/resubscribe on parent re-render (existing chat template).
- A test: render `useQuery` twice with the same `ref`/`args`/`items` module binding; observation count stays 1 across a parent `setState`.
- Guide one-liner: pass a module-level `defineItems` result, not an object literal.

## Resolution (2026-09-11)

The reported stable declaration case was already correct: replacing object identity with a WeakMap-derived identity has identical behavior and does not stabilize newly constructed declarations. A React regression rerenders the parent five times with a stable defineItems binding and fresh argument/options objects: exact published snapshot remains identical, logical subscription count stays one. Guide now explicitly says declare outside render. No hook identity churn was introduced.

Validation: affected offline public-state, auth ownership and client sessions suite passed 101/101; the added rendered expiry probe also passed. Package build and affected reference check pass.
