# Local proof root workspace lock omits the Expo package peer closure

**Status:** Resolved 2026-08-06
**Date:** 2026-08-06
**Impact:** 5
**Urgency:** 5
**Ease:** 5
**Confidence:** 5
**Systems:** Local proof, Package manager, Expo packaging, Release qualification
**Related:** `packages/snapback-expo/package.json`, `bun.lock`,
`scripts/check-required-surface-builds.mjs`,
`issues/closed/20260803-first-npm-latest-promotion.md`

## Summary

The complete local proof is red at `required-surface-builds` because its
mandatory root-workspace `bun install --frozen-lockfile` detects that the
tracked `bun.lock` would change.

This blocked the third 0.1.11 ten-package release attempt at clean candidate
`f6b7906ba817a710ee932e2cbf23cd9b29563bef`. No package was staged or
published by the attempt.

## Reproduction

Under the repository-pinned Node 24.18.0 with Exact required:

```sh
SNAPBACK_VERIFY_EXACT=1 volta run --node 24.18.0 -- \
  scripts/verify-local-proof --complete
```

The proof selects all 134 canonical gates, passes 47, then fails:

```text
[snapback-verify] GATE required-surface-builds
[snapback-verify] $ node scripts/check-required-surface-builds.mjs
[required-surface-builds] $ bun install --frozen-lockfile --cwd .
bun install v1.3.12 (700fc117)
error: lockfile had changes, but lockfile is frozen
[snapback-verify] FAIL required-surface-builds
```

The four gates that blocked the prior 0.1.10/0.1.11 attempts are green on
this candidate: capability maturity, agent-safe publication, client-bundle
metrology (56 profiles, no frozen-ceiling regressions), the hermetic Fleet
receipt, and demo materialization.

## Characterization

An isolated `git archive` of the exact candidate, with no checkout
`node_modules`, reproduced the drift under Bun 1.3.12. Running
`bun install --lockfile-only --ignore-scripts` there changed only `bun.lock`,
adding 913 lines. The first semantic delta adds the missing
`expo-file-system` peer to the `@expo/snapback-expo` workspace row, followed
by the Expo/React Native peer-resolution closure.

Commit `47b4a59ace9a0638a71cba69ee31c9ce9d4c8303` added
`expo-file-system >=57.0.0 <58.0.0` to
`packages/snapback-expo/package.json` but did not update `bun.lock`. The
candidate's tracked lock therefore no longer represents its workspace
manifests under the repository-pinned Bun.

## Release consequence

This is the fifth distinct central proof gate encountered by the successor
release sequence. Per the release task's fail-fast ruling, it must not be
fast-pathed or repaired inside the publishing attempt. Publication remains
blocked until a landed reconciliation makes the complete proof green on a
fresh `origin/main` candidate.

## Acceptance

- `bun install --frozen-lockfile --cwd .` passes under Bun 1.3.12 from a
  clean candidate checkout.
- The tracked lock represents every root workspace manifest, including the
  intentional `@expo/snapback-expo` peer-dependency shape.
- Package closure and required registry surface builds remain green; the
  repair does not hide an unintended Expo/React Native dependency in a
  publishable tarball.
- `SNAPBACK_VERIFY_EXACT=1 volta run --node 24.18.0 --
  scripts/verify-local-proof --complete` passes all 134 gates on the next
  release candidate before staging or npm mutation.

## Resolution

2026-08-06: root `bun.lock` regenerated under the pinned Bun 1.3.12 —
the drift was the `expo-file-system` dependency tree the E2 landing
(47b4a59ac) added to @expo/snapback-expo without a root-lock update.
`bun install --frozen-lockfile` verifies clean.
