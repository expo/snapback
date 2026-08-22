# `check-inventories` is red on main: the competitive-checkpoint manifest and the reviewed leaf set disagree

Status: Open — main is currently red on this gate
Created: 2026-08-22
Related: issues/20260821-check-inventories-has-no-mechanical-enforcement.md

## Symptom

    [check-inventories] FAIL agent-safe-publication-leaf-set
      reviewed at qualification C but missing on disk:
        demos/competitive-checkpoint/snapback/generated/api.d.mts

## What is actually wrong

The file is not missing. `demos/competitive-checkpoint/snapback/generated/api.d.mts` exists on
disk, is tracked, and is not gitignored.

"On disk" in this checker does not mean the filesystem. `generatedPublicationPathsOnDisk`
(`scripts/check-agent-safe-publication.mjs:814`) is manifest-driven: it reads each review cache
root's `artifacts.json` and admits only entries whose `custody` is `consumer-committed`.

The manifest at `demos/competitive-checkpoint/snapback/generated/artifacts.json` is
`manifestVersion: 2` with **65 files** — 54 `regenerable-cache`, 11 `consumer-committed` — and
**contains no entry for `api.d.mts` at all**.

Meanwhile `REVIEWED_GENERATED_PUBLICATION_PATHS` still lists it
(`tests/agent_safe_publication_checker_v1.mjs:2744`), along with `api.d.ts` and `api.mjs`
siblings.

So the manifest and the reviewed constant disagree. The gate is correct; one of its two inputs is
stale.

## How it got here

The manifest's mtime is 2026-08-22 05:42, so it was regenerated recently — most likely by
demo-surface work landing today. Regenerating the demo's artifacts changed the leaf set without
reconciling the reviewed constant, which is exactly the step the failure message names:

> review/regenerate the publication outputs, then reconcile REVIEWED_GENERATED_PUBLICATION_PATHS
> in tests/agent_safe_publication_checker_v1.mjs at qualification C

## Not caused by the fence program

Recorded because it blocks an otherwise-green gate and could be misattributed. It reproduces on
clean `main`, and the LLP 0283 fence landings modify no demo files.

## The decision needed

Someone who knows the demo-surface intent should determine which side is right:

1. **`api.d.mts` is still a consumer-committed leaf** — the manifest regeneration dropped it
   wrongly, and the manifest should be regenerated correctly.
2. **It is no longer a published leaf** — the reviewed constant should drop it and its `api.d.ts` /
   `api.mjs` siblings if they are in the same position, and the now-orphaned tracked file should be
   removed.

Do not simply delete the reviewed row to turn the gate green: that is the option that silently
changes what the publication surface claims to include.

## Related

This is the fourth distinct `check-inventories` red on main in two days. The others were stale
diagnostics projections (twice) and an unregistered test file. That gate has no hook or CI
enforcement, tracked separately in
`issues/20260821-check-inventories-has-no-mechanical-enforcement.md`.
