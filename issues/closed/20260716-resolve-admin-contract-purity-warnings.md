# Resolve admin Contract purity and ambient-state warnings

**Status:** Closed
**Severity:** P3
**Systems:** Admin UI, Contract/Exact, Production build
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** LLP 0017
**Marker:** maintenance

The admin production build succeeds, but Exact repeatedly warns that imports
used by `admin-ui/app.contract` claim argument-only purity while reading state
outside those arguments:

- `colors` reads the module-level `LIGHT` and `DARK` palettes.
- `initialTab` reads ambient browser `location` state.

These warnings make the canonical proof noisy and weaken the usefulness of the
compiler's dependency analysis. They may also conceal a future warning that is
actually unsafe.

**Done when:**

- Model the palette and initial-route dependencies honestly using the supported
  Contract import/dependency surface; do not merely suppress the diagnostics.
- Preserve light/dark theme behavior and hash-derived initial tab selection on
  web and native-capable builds.
- Add or strengthen a focused test that would fail if either dependency becomes
  implicit again.
- `admin-ui/build.sh` and the canonical local proof complete without these
  purity or ambient-host-state warnings.

## Resolution

Declared the theme helpers' real Contract dependency and effect model in
`admin-ui/theme.contract-meta.ts`: palette selection depends on the module-owned
`LIGHT`/`DARK` values, hash routing depends on the host `location` and URI
decoder, the initial theme snapshot declares its host reads, and the theme
watcher is a capability with scheme-read/subscription effects. Removed the
stale `initialTheme` descriptor, which did not name an exported helper.

Added a focused regression test that compares these descriptors with Exact's
own hidden-dependency analysis and exercises light/dark palettes, hash-derived
tabs, the location-free native fallback, host theme changes, and subscription
cleanup. The full admin test suite passes, and `admin-ui/build.sh` produces the
web and native artifacts without Contract purity, ambient-state, missing-
descriptor, or opaque-import warnings.
