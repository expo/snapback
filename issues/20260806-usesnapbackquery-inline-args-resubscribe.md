# useSnapbackQuery resubscribes every render when callers pass inline args objects

**Status:** Open
**Severity:** P3 (papercut — correct but wasteful)
**Systems:** snapback-react, live queries
**Date:** 2026-08-06
**Related:** `packages/snapback-react/index.mjs` (`useSnapbackQuery`), LLP 0183 (surfaced during Zerobugs control-app work)

## Problem

`useSnapbackQuery(reference, args)` memoizes its descriptor on the *identity*
of `args`:

```js
const descriptor = useMemo(
  () => provider.registry.descriptor(reference, args),
  [provider, reference, args],
);
```

When a caller passes an inline object literal — `useSnapbackQuery(issues.byLabel,
{label})` — `args` is a fresh object every render, so the descriptor memo
misses, `subscribe` is recreated, and `useSyncExternalStore` tears down and
re-establishes the subscription on every render. Behavior stays correct (the
registry's lease handoff — `subscribe(descriptor, listener, lease.current)` —
and the store keying on `canonicalReactStoreKeyV1` keep the underlying store
alive and the data continuous), but the churn is wasted work on every render
of every inline-args call site, and inline args objects are the natural way to
write the call.

Observed while building the Zerobugs control app, where the pattern shows up
in list views that render frequently.

## Done when

- The descriptor memo (or the registry `descriptor()` entry point) keys on the
  *canonical content* of `args` rather than object identity — e.g. reuse the
  canonical store key already computed by `canonicalReactStoreKeyV1`, or a
  stable serialization — so inline args objects with equal content produce a
  stable descriptor and no resubscribe.
- Same treatment considered for `useSnapbackPresence`'s
  `options.scope`/`options.value` deps, which have the same shape of hazard.
- A unit test in `packages/snapback-react/` asserts that re-rendering with a
  content-equal inline args object does not release/re-establish the
  subscription (observable via registry inspection or a counting fake).
- No behavior change for `skip` sentinel args or handoff descriptors.
