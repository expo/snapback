# `commands` subpath landed without its metrology profile, blocking every writer mode

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Testing
**Date:** 2026-08-06
**Related:** `issues/20260806-client-bundle-ratchet-red-on-main.md` (the blessed
growth this blocks minting), `issues/20260803-first-npm-latest-promotion.md`
(precondition 1), `issues/20260803-wave3-program.md` (needs a green named
commit)

## Summary

`17e7ca8ca feat(client,react,codegen,runtime): image-send command core + S2
commands admission` added a `./commands` subpath export to
`packages/snapback-client/package.json` without registering the corresponding
metrology profile. The computed additive profile set now contains
`resolved-public-subpath-commands`; the frozen
`tests/fixtures/client-bundle-metrology/baseline.local-sync-absence.v1.json`
does not. `validateSupplementalBaseline` fails:

```
AssertionError: baseline.local-sync-absence.v1.json: exact additive profile ids
-   'resolved-public-subpath-commands'
```

## Why it is worse than a red gate

`validateSupplementalBaseline` runs **before** the writer branches, so this
assertion fires in `--check`, `--write-supplemental-baseline`, **and**
`--write-rollover-baseline` alike. Every sanctioned way to update the
baselines is blocked by it. There is no writer mode that can make progress at
current `main`, which means:

- Charlie's 2026-08-06 blessing of the client-bundle growth **cannot be
  minted** at `main`. The rollover is authorized and verified but unlandable
  until this clears.
- The npm capstone's precondition 1 and the wave 3 close both remain blocked,
  now on this rather than on the growth itself.

The only ways out are to register the missing profile properly or to reconcile
the frozen supplemental — both code/config changes, not writer runs.

## Timeline (measured, same worktree, node 24.18.0)

| commit | bundle gate result |
| --- | --- |
| `8d9d33f28` | ratchet regression only (`external-react-application` 67,830) |
| `c7a8b9031` | ratchet regression only (92,688 — the blessed growth) |
| `17e7ca8ca` … `86e889800` | **`exact additive profile ids`** — writers blocked |

`c7a8b9031` is therefore the most recent commit whose only bundle-gate problem
is the blessed growth, and is a viable fallback named-commit candidate if this
cannot be cleared quickly.

## Fix

Register the `commands` profile the way the neighbouring subpath exports are
registered, so the computed and frozen additive sets agree, then mint the
supplemental. Do not delete the profile id from the computed set to silence
the assertion — the export is real and shipping, and an unmeasured public
subpath is exactly what this ledger exists to prevent.

## Pattern

This is the third distinct gate found red on `main` on 2026-08-06, all the
same shape: a landing changes a measured surface, the gate's frozen record is
not updated in the same change, and the failure surfaces days and hundreds of
commits later to whoever next tries to prove a commit. See also
`issues/20260806-main-red-agent-safe-leaf-set-drift.md` (red for 433 commits).
Under AGENTS.md's "main moves fast" guidance, gates whose records must be
hand-updated per landing need either same-change enforcement or a derivation
that does not require one.
