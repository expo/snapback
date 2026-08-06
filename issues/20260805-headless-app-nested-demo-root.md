# Shared headless helper assumes demos are exactly one directory deep

**Status:** Open
**Impact:** 1
**Urgency:** 1
**Ease:** 5
**Confidence:** 5
**Systems:** Demo kit, Acceptance testing, Developer experience
**Date:** 2026-08-05
**Governing:** LLP 0015 (acceptance rules)
**Related:** LLP 0176; `demos/_kit/headless-app.mjs`; Diary 0059

## Problem

`openHeadlessApp(metaUrl, ...)` derives the repository root with a fixed
number of parent traversals:

```js
const appDir = resolve(acceptanceDir, '..', '..');
const repoRoot = resolve(appDir, '..', '..');
```

That works for `demos/<app>/tests/acceptance`, but a comparison organized as
`demos/<bakeoff>/<arm>/tests/acceptance` resolves `demos/` as the repository
root. The Tandem messaging experiment had to copy the helper's lifecycle into
its own acceptance program and add another `..`.

This makes a reusable proof helper depend on an undocumented directory depth
and creates custom server/provisioning code in exactly the experiments that
most need comparable evidence.

## Fix shape

- Discover the repository root by walking upward from `metaUrl` to a stable
  repository marker instead of assuming the app's depth under `demos/`.
- Keep `appDir` derivation compatible for the current
  `tests/acceptance/headless.mjs` layout, and add an explicit `appDir` option
  if nested layouts cannot be inferred without ambiguity.
- Refuse with a direct diagnostic when no root or backend directory can be
  found rather than starting the server from a plausible wrong directory.

## Acceptance

- Existing one-level demo fixtures keep passing unchanged.
- A fixture under `demos/<suite>/<arm>/tests/acceptance` resolves the actual
  repository root and `<arm>/snapback` backend.
- A fixture outside a recognizable repository fails before server launch with
  the searched origin and expected markers in the error.
- The helper retains its current provenance, fresh product-client, auth lease,
  and cleanup behavior.
