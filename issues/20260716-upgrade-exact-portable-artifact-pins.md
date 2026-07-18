# Upgrade required demo surfaces to portable Exact artifacts

**Status:** Blocked
**Severity:** P2
**Systems:** Exact integration, Required demo surfaces, Generated artifacts, CI
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-16
**Related:** ENG-24452, ENG-25004, LLP 0015
**Marker:** build-integrity

The canonical proof currently allowlists both required Contract web surfaces
from artifact-path hygiene because their locked Exact suites predate the 0.1.5
portable-artifact fixes:

- `demos/all-aboard/surfaces/contract` pins `@exact/contract` 0.1.4.
- `demos/cursors-web/surfaces/contract` pins `@exact/contract` 0.1.2.

Rebuilding either surface can therefore embed absolute checkout paths in
production Contract IR, sourcemaps, or native module tables. The gate reports
the skip instead of failing until the lock-owned suite is upgraded.

**Done when:**

- Upgrade each surface's complete lockstep Exact suite to 0.1.5 or newer and
  refresh its frozen lockfile.
- Rebuild and review both tracked production `dist/` trees, including hashed
  asset replacement and native/static manifests.
- Confirm `scripts/check-required-surface-builds.mjs` produces no uncommitted
  diff on a clean checkout.
- Confirm `scripts/check-artifact-path-hygiene.mjs` scans both surfaces and
  reports no absolute-path finding or skip.
- Remove the obsolete pre-portability allowlist versions once no maintained
  surface depends on them, and keep the rollback regression covered.

## Blocker and evidence

This work is blocked on a published, lockstep Exact release containing the
portable-artifact fixes. On 2026-07-16, the public npm registry reported
`0.1.4` as both `latest` and the newest published version for each package
these surfaces consume directly:

- `@ccheever/exact-contract`
- `@ccheever/exact-core`
- `@ccheever/exact-devtools`
- `@ccheever/exact-renderer`
- `@ccheever/exact-router`

`npm view @ccheever/exact-contract versions time --json` listed only
`0.1.0` through `0.1.4`. The Exact changes for ENG-24452 and ENG-25004 landed
after the `0.1.4` publication, so no published package currently satisfies the
ticket's `0.1.5+` portability requirement. An ambient Exact checkout, local
tarball, git dependency, or hand-edited `dist/` would violate LLP 0015's
lock-owned published-package and frozen-install constraints; the existing
pre-portability allowlist must therefore remain until the release exists.

Reverified on 2026-07-17: the public registry still reports `0.1.4` as the
newest version for all five required `@ccheever/exact-*` packages listed above.
The blocker and safe-resume sequence are unchanged.

## Safe resume steps

1. Publish one coherent Exact suite version `0.1.5` or newer containing both
   ENG-24452 and ENG-25004, then verify the required package versions from the
   public npm registry.
2. Pin every direct `@exact/*` alias in both surface `package.json` files to
   that same suite version and regenerate each `bun.lock` from the registry.
3. Run `bun install --frozen-lockfile` in each surface and confirm the installed
   packages resolve inside that surface's own `node_modules` tree.
4. Rebuild both tracked production `dist/` trees and review the hashed assets,
   sourcemaps, and native/static manifests.
5. Run `node scripts/check-required-surface-builds.mjs` and then
   `node scripts/check-artifact-path-hygiene.mjs`; both surfaces must be scanned
   without findings or skips.
6. Only after both pins are upgraded, delete the pre-portability allowlist,
   replace its skip regression with a rollback-fails regression, update the
   affected demo diaries, and close this ticket with the proof results.
