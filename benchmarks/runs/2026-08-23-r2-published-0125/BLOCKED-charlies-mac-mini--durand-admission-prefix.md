# R2 Mac-mini continuation blocked by landed admission prefix check

**Status:** Blocked before admission for `sol-coterie-familiar`; no remaining
cell was started.
**Observed:** 2026-08-24 14:06 PDT (2026-08-24T21:06Z)
**Campaign runner revision:** `c26bb9729667af406aa74d7819b317bda57a343e`
**Requested cells:** `sol-coterie-familiar`, `grok-clique-explicit`,
`grok-clique-familiar`, `grok-coterie-explicit`, `grok-coterie-familiar`
**Instrument:** `social-messenger@0.3.3-m8`

## Blocking condition

The checkout was clean after `git fetch origin main` and was reset exactly to
`origin/main`. With the forbidden Node loader/preload variables scrubbed as
required by the frozen execution policy, the landed `validate-plan.mjs`
reported the expected pre-existing noncontiguous-slot diagnostic:

```text
R2_PLAN_INVALID: later cell slot is not pristine: opus-clique-explicit
```

Per the continuation ruling, that known plan-validator result was noted and
execution proceeded to the exact landed admission command for
`sol-coterie-familiar`. The admission tool exited 2 before acquiring the host
lock or taking its first load sample:

```text
R2_ADMISSION_PRISTINE: later slot opus-clique-explicit is not pristine
```

This is not a load-ceiling failure. The landed admission implementation calls
`inspectCommittedSeriality()` before the three-sample loop and requires every
slot after the committed prefix to be pristine. The retained finalized
`opus-clique-explicit` record is outside the prefix because the consumed
`sol-coterie-explicit` cell has only its landed driver-crash report and must
remain unrerun. The exact lane-controller repeats the same seriality check
before importing the driver or creating the private attempt capsule.

Consequently, no valid admission artifact can be produced and the registered
lane-controller command cannot start. Continuing would require changing or
bypassing the landed admission/controller path, both forbidden for this
campaign. No product, harness, driver, controller, configuration, existing
record, or consumed-cell report was modified.

## Retained evidence and non-attempt disposition

- No `admissions/sol-coterie-familiar.json` was created.
- No private `cells/sol-coterie-familiar` directory exists.
- No campaign host lock exists.
- No load samples were taken because admission failed before the sampling
  phase.
- No lane-controller or native model process was launched, and no listener was
  present on the registered ports 42060-42079 after the refusal.
- `sol-coterie-familiar` and all four requested Grok cells remain unattempted.
- Recorded cells and consumed cells were not touched or rerun; Claude cells
  were not run on this host.

An initial unsanitized plan-validation invocation was rejected solely because
the conductor shell inherited `NODE_PATH`. It made no writes. The command was
rerun with exactly the forbidden variables from
`execution.environment.forbiddenVariables` removed, producing the governing
Opus-prefix result above.

## Required resume condition

Resume only after a landed, deliberately governed campaign-state mechanism
allows the admission tool and lane-controller to recognize consumed
failure/block reports without treating those cells as rerunnable or requiring
the later retained Opus record to be pristine. Then start
`sol-coterie-familiar` with a fresh three-sample admission window. Do not
fabricate an admission artifact, invoke the driver directly, alter an existing
slot, or rerun a consumed attempt.
