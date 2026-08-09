# Published Expo config plugin package root is not resolvable by EAS CLI

**Status:** Closed 2026-08-09 — repair `a951074e4`, first published in `0.1.12`,
verified present in the `0.1.15` registry bytes
**Impact:** 4
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Expo package, Config plugin, EAS, Packaging
**Date:** 2026-08-06
**Related:** LLP 0176 §G4, LLP 0181 §Config plugin,
`../20260806-guide-gap-g4-live-0110-external-vector.md`

## Finding

The 0.1.11 guide/README entry is `"@expo/snapback-expo"`. `expo config`
loads it, but noninteractive `eas init` fails after creating the remote project:

```text
Failed to resolve plugin for module "@expo/snapback-expo"
```

The package root exports only `types` and `import`; EAS's CommonJS resolver
therefore has no root target. The already-public
`@expo/snapback-expo/app.plugin` subpath works and allowed both authorized EAS
development-client builds to proceed without a package patch.

## Source repair in this worktree

The root conditional export now returns `index.mjs` to ESM importers and
`app.plugin.js` to CommonJS plugin resolvers, while retaining the explicit
subpath. `package.test.mjs` requires the package root and pins that it resolves
to the same config plugin.

## Acceptance

- `expo config` and noninteractive EAS project linking both accept the
  documented package-root spelling.
- Package ESM imports still expose the runtime facade.
- A successor npm tarball contains the conditional root export and the G4 EAS
  stage/build rerun needs no subpath workaround.

## 2026-08-07 landing note

The root `require` conditional export repair described above landed on main in
`a951074e4` (the 0.1.11 G4 rerun landing). No published registry byte has
changed; this ticket closes when the next promoted closure ships the repair
and the G4 rerun reclaims the acceptance.

## Resolution (2026-08-09) — published in 0.1.12, verified in 0.1.15

**Resolving commit:** `a951074e47839c741663f4f496178c3c6c0738a2`
(2026-08-06 18:12 PDT).
**First published version:** `0.1.12` (revision
`fad3d53922e920d9cdc23a2b5b9cad84e3c872c0`, retained ledger
`~/snapback-release-ledgers/fastpath-ledger-0.1.12-fad3d53922.json`;
`a951074e4` is an ancestor of it). `latest` is now `0.1.15`.

**Registry spot-check (2026-08-09).** `npm view @expo/snapback-expo@0.1.15
exports` returns the conditional root:

```json
    ".": {
      "types": "./index.d.mts",
      "import": "./index.mjs",
      "require": "./app.plugin.js",
      "default": "./index.mjs"
    }
```

CommonJS resolvers — EAS's plugin resolver among them — now get
`app.plugin.js` from the bare package root, ESM importers still get the runtime
facade at `index.mjs`, and the explicit `./app.plugin` subpath is retained, so
both spellings work. `npm view @expo/snapback-expo versions` confirms 0.1.12
through 0.1.15 all exist.

**What this close does not claim.** The third acceptance bullet's second half —
that the G4 EAS stage/build rerun needs no subpath workaround — is a live
measurement against a fresh external quarry and has not run. It belongs to the
G4 rerun (`../20260806-guide-gap-g4-live-0110-external-vector.md`, claimed in
`../20260809-g4-rerun-lane-plan.md`), not to a second copy of this ticket. The
package-level acceptance (`expo config` accepts the root spelling, ESM imports
still expose the facade, `package.test.mjs` pins that the root `require`
resolves to the config plugin) landed with `a951074e4` and shipped.
