# Supervised Expo web cannot bundle: shared-browser-adapter uses bare dynamic import(specifier)

**Status:** Open
**Opened:** 2026-08-24
**Impact:** 5
**Urgency:** 5
**Ease:** 4
**Confidence:** 5
**Systems:** React/Expo, Client integration, Packaging
**Related:** LLP 0307 (Track Q-a probe, published-0.1.26 finding 1),
`benchmarks/runs/2026-08-24-qa-ports-probe-0126/record.md`

## Problem

On published 0.1.26 (and current main), `snapback dev --expo
--expo-platform web` cannot bundle the browser client at all. Metro's
transform refuses the dynamic import in
`packages/snapback-expo/shared-browser-adapter.mjs:137`:

```
node_modules/@expo/snapback-expo/shared-browser-adapter.mjs: Invalid call
at line 137: import(specifier)
Web Bundling failed … (465 modules)
```

Cause: `resolveExpoSharedBrowserModules(load = (specifier) =>
import(specifier))` — Metro statically analyzes dynamic `import()` calls
and rejects a non-literal specifier. The browser client can never boot on
the supervised web path, which masks every downstream behavior (the Q-a
probe could not even observe `SNAPBACK_REACT_BINDING_MISMATCH`). No
`SNAPBACK_*` diagnostic covers the failure; the agent had to read the
published file to understand it — itself a paved-path violation.

Found by the LLP 0307 Track Q-a qualification probe on a clean published
scaffold; reproduces deterministically.

## Wanted

- Make the default loader Metro-safe: an indirection Metro cannot
  statically reject (or platform-conditional wiring that never presents a
  bare dynamic import to the bundler), preserving the injection seam for
  tests.
- A packed/template-level check that the supervised web bundle actually
  completes — this class must fail in qualification, not in the first
  agent's first hour. The 0.1.26 closure passed its template static
  acceptance while web bundling was broken; the acceptance gap is part of
  this ticket.
- Rides the next publication; until then, published supervised Expo web is
  broken and the capability index/guide must not claim otherwise.

## Acceptance

- `snapback dev --expo --expo-platform web` on the shipped template
  bundles and boots the browser client from packed/published packages.
- A closure/template acceptance step fails if web bundling fails.
- The injection seam for `resolveExpoSharedBrowserModules` remains
  testable.
