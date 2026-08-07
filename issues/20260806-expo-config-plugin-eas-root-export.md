# Published Expo config plugin package root is not resolvable by EAS CLI

**Status:** Open — source repair landed on main (`a951074e4`, 2026-08-07); only a
successor published release (a closure newer than 0.1.11) remains
**Impact:** 4
**Urgency:** 4
**Ease:** 5
**Confidence:** 5
**Systems:** Expo package, Config plugin, EAS, Packaging
**Date:** 2026-08-06
**Related:** LLP 0176 §G4, LLP 0181 §Config plugin,
`issues/20260806-guide-gap-g4-live-0110-external-vector.md`

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
