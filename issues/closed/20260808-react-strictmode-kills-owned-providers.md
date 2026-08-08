# React StrictMode / remount permanently kills owned providers (Expo boot hangs at fallback forever)

**Opened:** 2026-08-08 · **Severity:** P1 (dev-mode-only, but the app never boots under StrictMode) · **Area:** snapback-react / snapback-expo

## What

`packages/snapback-expo/provider.mjs:422-430`;
`packages/snapback-react/index.mjs:2498-2507` (also `useSnapbackAssetUpload`
:3621-3626).

```js
const boot = useMemo(() => createSnapbackExpoBoot({ app, binding, environment }), [...]);
useEffect(() => { void boot.start(); return () => { void boot.dispose(); }; }, [boot]);
```

React 18+ `<StrictMode>` (dev) simulates a remount: effect runs → cleanup runs →
effect runs again, with the **same memoized** object. `boot.dispose()` sets
`disposed = true` and aborts the controller irreversibly; the second `start()`
returns the same in-flight promise whose `run()` hits `if (disposed) return
state` — the boot never publishes `ready`, so the app renders the fallback
forever.

`SnapbackProvider` with a `binding` prop is worse: `owned.dispose()` sets
`registry.terminal = true`, and the re-run subscribe throws
`SNAPBACK_REACT_PROVIDER_CLOSED` through the render tree. StrictMode also
double-invokes the `useMemo` initializer, and `createSnapbackReactProvider` has
construction side effects (`registerDurableConsumer` :451,
`registerAuthBarrierParticipant` :2090, manager creation :341) — the discarded
instance leaks those registrations on the shared client with no dispose path.
`useSnapbackAssetUpload` similarly `release()`s its ref-cached store on cleanup
then keeps using the detached store, so registry-wide blanks (custody change) no
longer reach it.

## Why the tests miss it

The existing StrictMode test (`snapback-react/package.test.mjs:488`) only
exercises the externally-owned `provider` prop path, not the owned-resource
paths.

## Fix

Make owned-resource creation effect-driven (create in the effect, hold in state,
dispose in that effect's cleanup), or make `dispose()`/`start()` re-entrant (a
disposed boot re-creates on next `start()`). Keep `createSnapbackReactProvider`
side-effect-free until an explicit `start()`.

## Confidence

High on mechanics; no comment claims StrictMode support either way, so untested
rather than deliberate.

## Resolution (2026-08-08)
Fixed on main (Lane D). Verified: snapback-react / snapback-client / snapback-expo test suites + TS fixtures pass; ref-check clean. Regressions added for StrictMode owned-provider/boot/asset-upload lifecycle and all three live-recovery paths.
