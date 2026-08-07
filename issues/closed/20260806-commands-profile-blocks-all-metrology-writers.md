# `commands` subpath landed without its metrology profile, blocking every writer mode

**Status:** Resolved
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

## 2026-08-06 — the writer blocker is cleared; the gate is still red on a different ticket

Measured in a fresh worktree at `47b4a59ac` (origin/main tip), volta node
24.18.0, fresh `bun install`:

- `382958bde test(metrology): freeze S2 command profiles` landed the missing
  `commands` profile registration and the supplemental rollover, and is an
  ancestor of the tip. `validateSupplementalBaseline` now passes: the
  `exact additive profile ids` assertion this ticket is about no longer
  fires, and `--check` runs all the way through to `compareProfiles`. **The
  writer modes are unblocked** — the headline claim above ("there is no
  writer mode that can make progress at current `main`") is no longer true.
- `node scripts/client-bundle-metrology.mjs --check` is nevertheless still
  red, with a *different* failure:
  `SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED` — 18 metric regressions across
  `external-react-application`, `react-external`, `public-subpath-assets`,
  `public-subpath-commands` and their `resolved-*` twins (e.g.
  `external-react-application` minifiedBytes 89,345 → 91,033), plus the
  1-byte `public-subpath-ir-evaluator` brotliBytes 6,739 → 6,740 residue.
- That ratchet failure is the separately-tracked, still-open
  `issues/20260806-client-bundle-metrology-red-on-main.md` (pre-existing,
  environment-implicated — the baseline-freezing commit itself no longer
  reproduces its own baselines). It is not this ticket's defect and was not
  chased here.

Left **Open** rather than closed: the symptom this ticket names is gone, but
the leg it exists to unblock (minting the blessed growth / the npm capstone's
precondition 1) still cannot be proven green until the ratchet ticket clears.
Whoever closes the ratchet ticket should re-run `--check` and close this one
in the same pass.

## Resolution — final writer and ratchet pass

The guarded rollover writer completed under Node 24.18.0 after running its
full declared behavior train and minted
`baseline.e2-command-correctness.v1.json` for exactly the seven remaining
E2/command/auth profiles. The receipt SHA-256 is
`72ee7957076b1988aadefc6fbd843b000bb0abb0f29755e3c3a8fd70c7694baf`.
The ordinary `--check` path now validates both supplemental command profiles,
all prospective rollovers, and all 56 measured profiles without a writer
bypass. This discharges the remaining condition above, so the ticket closes.
