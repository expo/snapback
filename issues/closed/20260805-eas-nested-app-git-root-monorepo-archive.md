# EAS build resolves the Snapback monorepo Git root from a nested demo app

**Status:** Resolved (2026-08-05)
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Expo/EAS, Developer experience
**Date:** 2026-08-05
**Governing:** LLP 0041, LLP 0103
**Related:** LLP 0176; `demos/tandem-expo-bakeoff/scripts/build-ios-dev-client`;
`issues/20260805-local-source-package-closure-needs-contract-override.md`;
Diary 0059 ("Expo and device packaging")

## Problem

Running `eas build` from an app nested inside this repository (for example
`demos/<bakeoff>/<arm>`) resolves EAS's project root at the repository's Git
root rather than the nearest Expo project. EAS then spends minutes compressing
and uploading the entire Snapback monorepo checkout — the Rust runtime,
`vendor/ibex`, every other demo, and all workspace `node_modules` — instead of
just the app being built.

This reproduced independently in two concurrent bakeoffs (`tandem-expo-bakeoff`
and `relay-room-bakeoff`), both of which built the same workaround
independently: add minimal native "shell" apps outside the monorepo checkout
that carry only the native dependencies/config and load the real product
bundle from the parent Metro server, then stage and build from that shell.
`.easignore` and EAS's no-VCS mode did not fix the underlying root resolution;
only building from a directory outside the checkout did.

This is ceremony a normal external Expo/Snapback consumer would never carry —
a repository detail leaking into the packaging path for anyone developing a
Snapback app inside this checkout (demos, internal prototypes, or a workspace
adopted via the monorepo pattern).

## Fix shape

- Give EAS an explicit project boundary (e.g. `easBuildProjectRoot` /
  `eas.json` root config, or a documented nested-app pattern) instead of
  relying on Git-root auto-detection, so a nested app's build only archives
  that app's tree.
- If EAS itself has no first-party fix, document and paved-path the
  repeatable staging helper (as `demos/tandem-expo-bakeoff/scripts/build-ios-dev-client`
  already prototypes) as the supported pattern for any Snapback app built
  from inside this checkout, rather than leaving it as bakeoff-local lore.
- Cover this in the `eas-app-stores` skill or the guide's packaging page so
  the next nested-app builder does not rediscover it from a multi-minute
  archive-upload timeout.

## Acceptance

- A demo or internal app nested under this repository's Git root builds an
  EAS ad hoc/development-client archive scoped to that app (comparable in
  size to an equivalent standalone Expo project), not the whole monorepo.
- The supported pattern is documented, not just proven inside one bakeoff's
  scripts directory.

## Resolution

Resolved 2026-08-05 on `fix/nested-app-root-resolution` per this ticket's own
fallback prescription: no first-party EAS nested-root configuration could be
verified (the `eas-app-stores` skill contents document no monorepo/project-root
setting, and both bakeoffs independently proved `.easignore` and no-VCS mode do
not change root resolution), so the staging workaround is now the paved,
documented path.

- `demos/_kit/eas-stage-build.mjs` (new) generalizes
  `demos/tandem-expo-bakeoff/scripts/build-ios-dev-client`: it stages any
  nested app into an out-of-checkout temp directory (excluding
  `node_modules`, `.expo`, `.git`, `dist` at every depth), **refuses any
  staging directory that is still inside a Git checkout**, then runs
  `bun install` and `eas build` from the staged copy
  (`EAS_NO_VCS=1`/`EAS_PROJECT_ROOT` kept as belt-and-suspenders). A free
  `--stage-only` mode stages and reports (file count, bytes, kept path) with
  no dependency install and no EAS contact — that is the in-repo verification
  seam, since a real EAS build is a paid external service.
- The tandem prototype script now delegates to the shared helper (thin
  arm-selection wrapper).
- Verified: `--stage-only` against
  `demos/tandem-expo-bakeoff/snapback/native-shell` staged exactly the 9 app
  files (224 KiB) — versus the multi-gigabyte monorepo archive the Git-root
  resolution produced — and the staged path has no `.git` ancestor. Staging
  and refusal behavior are unit-tested in
  `demos/_kit/tests/repo-layout-unit.mjs` (`repo-layout-unit` proof gate).
- Documented in the guide: `guide/clients/react-expo.md`, "Build an EAS dev
  client for an app nested inside this repository" (prose + illustrative `sh`
  fence rather than a transcluded-verified snippet, because the technique's
  execution cannot be CI-carried — EAS is paid/external; the helper's staging
  behavior is CI-verified via the unit suite), plus an anti-pattern entry.
  LLP 0176 A3 updated to point here.
- What remains inherently external: an actual first-party EAS fix (an
  explicit project-root boundary honored by `eas build` archive collection)
  can only land upstream in EAS/eas-cli. If that ever ships, the helper can
  shrink to a shim; the in-repo paved path above closes this ticket per its
  acceptance line ("the supported pattern is documented, not just proven
  inside one bakeoff's scripts directory").
