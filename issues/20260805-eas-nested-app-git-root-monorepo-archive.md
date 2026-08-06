# EAS build resolves the Snapback monorepo Git root from a nested demo app

**Status:** Open
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
