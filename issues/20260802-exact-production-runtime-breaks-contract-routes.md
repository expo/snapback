# Exact 0.1.7 production runtime breaks every Contract route; cold-clone acceptance is 1/34

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 2
**Confidence:** 5
**Severity:** P1
**Systems:** CI, Demos, Exact
**Author:** Claude (Fable 5), directed by Philippe Loulidi
**Date:** 2026-08-02
**Related:** issues/closed/20260802-cold-clone-codegen-graph-not-materialized.md

The All Aboard Contract surface builds clean but does not boot in a
**production** build. Every route fails to load, so the cold-clone browser
acceptance reports `FAIL all-aboard browser (Phase 1) — 1/34`.

## The chain (all verified, not inferred)

1. The `@exact/devtools` contract-web preset rewrites the runtime specifier
   for production builds only
   (`src/contract-web.ts`, `resolveId`): `@exact/contract/runtime` ->
   `@exact/contract/runtime/production`.
2. `@exact/router`'s `defineContractRouteModule` loads that specifier and
   calls a member on it (`src/contract.ts:6156`):

   ```js
   const runtime = await import('@exact/contract/runtime');
   if (!runtime.isCompiledComponent(module.default) && ...
   ```

3. `@exact/contract`'s production entry (`src/runtime/production.ts:77`)
   re-exports only part of `define.js`:

   ```ts
   export { defineComponent, type CompiledComponent } from './define.js';
   ```

   `isCompiledComponent` is defined in `define.ts:100` and re-exported by the
   **non**-production runtime index, never by `production.ts`.

Net effect in production: `runtime.isCompiledComponent` is `undefined`, the
route loader throws, the app shows
`Boot failed: (intermediate value).isCompiledComponent is not a function`,
and only 1 of 34 acceptance checks passes.

Reproduced locally against the committed pin (`@exact/*` 0.1.7 from npm):
serve `demos/all-aboard/surfaces/contract/dist/web` and load it in headless
Chrome; the boot error appears in the console and in the `#boot-status`
element. Dev builds are unaffected because the alias only applies to
production, which is why `required-surface-builds` (build-only) stays green:
this is exactly the DEV-GREEN / SHIP-BROKEN class ENG-22543 exists to catch,
but that lane never boots the app.

## Not only 0.1.7

The same omission is present on the current Exact checkout
(`~/Documents/expo/exact`, `packages/exact-contract/src/runtime/production.ts`
line 77 re-exports `define.js` without `isCompiledComponent`, while
`packages/exact-router/src/contract.ts:6454` still calls it). So bumping the
pin alone will not fix this; the export has to be added upstream.

## A second production-only fault behind it

Adding `isCompiledComponent` to the production re-export locally (node_modules
edit, reverted) moves the boot further and reveals a second one:

```
Boot failed: [contract] production artifact omitted the AOT closure for
expression kind "ident"
```

So there are at least two production-artifact faults, not one. The fix must
be validated by a green 34/34 acceptance, not by clearing the first error.

## Why this is Exact work, not Snapback work

Both faults live in published Exact packages and in Exact's source. Snapback
can only pin a fixed version. This needs Exact-side coordination, so it
should graduate to Linear (Exact project, Snapback label) rather than being
fixed here.

Exit: an Exact release whose production runtime boots the All Aboard Contract
surface, the Snapback pin bumped to it, and
`scripts/cold-clone-check.sh` green at 34/34.
