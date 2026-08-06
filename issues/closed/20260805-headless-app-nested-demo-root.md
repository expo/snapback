# Shared headless helper assumes demos are exactly one directory deep

**Status:** Resolved (2026-08-05)
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

## Resolution

Fixed 2026-08-05 on `fix/nested-app-root-resolution`.

- `demos/_kit/repo-layout.mjs` (new) owns layout resolution. The repository
  root is found by walking upward from the suite's `import.meta.url` to the
  nearest ancestor carrying **both** a `.git` entry (directory or worktree
  file) and this repo's root-only `ref-check` executable — no depth
  assumption. The app directory is inferred as the nearest ancestor of the
  acceptance directory, strictly below the repository root, that owns a
  `snapback/schema.mjs` backend source; `openHeadlessApp` gained an explicit
  `appDir` option (absolute or repo-root-relative) for layouts the walk
  cannot infer.
- Every unresolvable case refuses with a stable code before any server is
  launched: `SNAPBACK_KIT_REPO_ROOT_NOT_FOUND` (names the searched origin and
  the expected markers), `SNAPBACK_KIT_APP_DIR_NOT_FOUND`,
  `SNAPBACK_KIT_BACKEND_NOT_FOUND`, and
  `SNAPBACK_KIT_GENERATED_ARTIFACTS_MISSING` (with the codegen command).
- `demos/_kit/headless-app.mjs` consumes the resolver; its provenance-declared
  server start, fresh post-provision product client, provisioner auth-lease
  release, and cleanup behavior are unchanged.
- Unit coverage: `demos/_kit/tests/repo-layout-unit.mjs` (registered as
  `repo-layout-unit` in `scripts/verify-local-proof`) proves the one-level
  layout, the nested `demos/<suite>/<arm>/tests/acceptance` layout (arm
  deliberately named `snapback`), outside-a-repo refusal with origin+markers
  in the message, no-backend refusal, and the explicit `appDir` override — no
  server launched. Live check: `demos/chirp/tests/acceptance/headless.mjs`
  passed 5/5 through the modified helper against a real server.
- The Tandem copy (`demos/tandem-expo-bakeoff/snapback/tests/acceptance/headless.mjs`)
  now uses the shared `resolveHeadlessAppLayout` for its paths, but keeps its
  local lifecycle with a dated note: it exercises startup-artifacts boot,
  host-ops `app.reset` seeding, and a real auth-code exchange, which
  `openHeadlessApp`'s `ensureApp` flow deliberately does not cover.
