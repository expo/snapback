# Codegen pretest red: `assets.media-ref-projection.v1` unsupported on `local-dev-sqlite-ibex`

**Status:** Open
**Impact:** 2
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Systems:** Codegen, Assets/MediaRef rollout, Package tests
**Date:** 2026-08-15
**Related:** LLP 0239 (MediaRef), `issues/20260815-finish-media-happy-path.md`,
`issues/20260812-media-ref-snapshot-projection.md`
**Found while:** Supervised 2026-08-15 ticket-fix run (jspack lane baseline verification)

## Problem

`bun run pretest` in `packages/snapback-codegen` fails deterministically at
clean `main` `a93a11235` (verified in an untouched worktree with a fresh
`bun install`):

```text
SNAPBACK_CAPABILITY_UNSUPPORTED: target local-dev-sqlite-ibex does not
support required capability assets.media-ref-projection.v1
```

A pretest fixture backend now requires the MediaRef projection capability
(landed with the familiar video-intent work, `740b8fe92`-era), but the
`local-dev-sqlite-ibex` target capability manifest does not declare it. Every
isolated codegen package run is red before the real tests execute.

This looks like ordinary mid-rollout drift of the active LLP 0239 media
program (which has its own open tickets and an in-flight lane); filing
narrowly so the package-suite redness is tracked rather than silently
inherited by unrelated lanes.

## Desired outcome

Whoever lands the next MediaRef slice either declares the capability on the
local-dev target (if the projection is now genuinely supported there) or
gates the fixture's requirement so the codegen pretest runs green on targets
without it. The fixture must keep failing if a backend genuinely requires a
capability its target cannot serve.

## Acceptance

- `bun run test` in `packages/snapback-codegen` passes from a fresh clone.
- The capability manifest and the fixture requirement agree deliberately, not
  by deletion of the check.

## Resolution — 2026-08-17 (backlog sweep)

The original pretest refusal was `SNAPBACK_CAPABILITY_UNSUPPORTED` for
`assets.media-ref-projection.v1` on `local-dev-sqlite-ibex`. That capability
is now declared experimental on
`schemas/capability.manifest.local-dev-sqlite-ibex.json`, so the fixture
requirement and target catalog agree. Remaining pretest redness after that
declaration was scoped into
`issues/closed/20260816-ownership-composition-fixture-wave.md` and resolved
there.
