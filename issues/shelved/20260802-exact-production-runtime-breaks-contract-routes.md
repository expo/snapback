# Exact 0.1.7 production runtime breaks every Contract route; cold-clone acceptance is 1/34

**Status:** Open — regression reconfirmed 2026-08-04
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

## Retested against 0.1.10 — 2026-08-03

Exact published 0.1.8, 0.1.9 and 0.1.10 on the evening of 2026-08-02. **The
first fault is fixed, the second is not, and the app still does not boot.**

`@ccheever/exact-contract@0.1.10`'s `src/runtime/production.ts` now re-exports
`isCompiledComponent` alongside `defineComponent`. Bumping every `@exact/*`
pin in the surface to 0.1.10 and rebuilding gets past the route loader and
straight into the second fault:

```
Boot failed: [contract] production artifact omitted the AOT closure for
expression kind "ident"
```

Verified by building the surface on 0.1.10 and loading `dist/web` in headless
Chrome, not by reading the diff. The pin bump is reverted; it does not help
on its own.

The second fault is a compiler emit gap rather than a runtime one.
`evalRuntimeExpr` (`src/runtime/execution.ts:46`) requires every expression to
carry a precompiled AOT closure when `CONTRACT_PRODUCTION_BUILD` is set; the
interpreter fallbacks are deliberately excluded from production bundles, so an
expression without a closure has nowhere to go and throws. The emitter did not
produce one for an expression of kind `ident` — a plain identifier reference,
about the most basic kind there is, which is consistent with no route booting
at all rather than an exotic edge case failing.

This is the case the exit criterion was written for: three releases shipped
against the first error message, and the surface is still dead in production.

## Why this is Exact work, not Snapback work

Both faults live in published Exact packages and in Exact's source. Snapback
can only pin a fixed version. This needs Exact-side coordination, so it
should graduate to Linear (Exact project, Snapback label) rather than being
fixed here.

Exit: an Exact release whose production runtime boots the All Aboard Contract
surface, the Snapback pin bumped to it, and
`scripts/cold-clone-check.sh` green at 34/34.

## Resolution — 2026-08-02

Exact published the complete 20-package `@ccheever/exact-*` closure at
`0.1.10` from `9cf261622bf23f1ac510d799011cbef852180bc9`. The upstream
fix chain did more than add the missing classifier: the production runtime
now exports `isCompiledComponent`, a derived router-boundary parity test
checks every runtime value used through the production rewrite on web and
native, the published devtools graph declares its module-lexer dependencies,
the full web entry installs image prop semantics, and the external
Contract-web preset preserves the full renderer host pair during development
while retaining the lightweight direct host for production builds. The
reported AOT `ident` closure fault did not recur in the final registry build
or browser boot.

Snapback now pins `0.1.10` in both lock-owned Contract surfaces
(`all-aboard` and `cursors-web`) with regenerated frozen locks and rebuilt
tracked production artifacts. The pager CSS assertion was realigned to
Exact LLP 0336's accepted ENG-24312 shape: claim regions and browser-owned
edge guards remain `touch-action: auto`, while interior horizontal-pager
cells carry `pan-y`.

Final evidence:

- `node scripts/check-required-surface-builds.mjs` — both required registry
  surfaces production-built successfully.
- `scripts/cold-clone-check.sh` — frozen registry install, production build,
  and browser acceptance all passed: `34/34` (browser leg 92s).

Exit criteria are satisfied; this ticket is closed on the cold-clone
evidence, not merely on the upstream export patch.

## Reopened — 2026-08-04

The recorded resolution was not supported by the command it cited. The
current `scripts/cold-clone-check.sh` production-builds `dist/web`, but its
browser acceptance starts Vite in development mode and loads `main.ts`; it
does not serve or boot the production output. While investigating Linux
Chrome 151's `ERR_INSUFFICIENT_RESOURCES` failure on a second dev-module
graph, a proposed fixture change rebuilt `dist/web` against the run's fresh
API origin and served it with `vite preview`. The very first boot check failed
on the registry-pinned Exact `0.1.10` packages with the same error recorded
above:

```text
[contract] production artifact omitted the AOT closure for expression kind "ident"
```

That proposed fixture path was rejected rather than used to make the CI run
green, and no Exact or F0a-owned code was changed in this drift pass. The
existing dev-browser lane continues to cover its declared 34 behaviors, but
it cannot serve as evidence that the production bundle boots. This ticket is
open again on its original exit criterion: publish an Exact closure whose
production artifact boots, pin it here, and add a browser leg that actually
serves `dist/web` so the resolution cannot regress behind a build-only gate.
