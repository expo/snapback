# R2 Mac-mini continuation blocked by absent registered instrument

**Status:** Blocked before admission for `sol-coterie-familiar`; no remaining
cell was started.
**Observed:** 2026-08-24 14:37 PDT (2026-08-24T21:37Z)
**Campaign runner revision:** `1cb5a23074e3f0faaf22d9ae9b88c6030a3068c6`
**Requested cells:** `sol-coterie-familiar`, `grok-clique-explicit`,
`grok-clique-familiar`, `grok-coterie-explicit`, `grok-coterie-familiar`
**Instrument:** `social-messenger@0.3.3-m8`, manifest SHA-256
`13d5fe72dfdf5f401b1e81452f1668af071fb83093cdb92aed1941db61ddff3d`

## Blocking condition

The checkout was clean after `git fetch origin main` and was reset exactly to
`origin/main`. The first plan-validation invocation inherited `NODE_PATH` from
the conductor shell and was refused by the registered environment policy. It
made no writes. With exactly the forbidden Node loader/preload variables
scrubbed, the landed `validate-plan.mjs` passed and resolved
`sol-coterie-familiar` as the next undispositioned cell:

```text
{"ok":true,"recordedPrefixLength":3,"nextCell":"sol-coterie-familiar"}
```

The exact landed admission command for `sol-coterie-familiar` then exited 2
before acquiring the host lock or collecting the first load sample:

```text
R2_ADMISSION_INSTRUMENT: materialized snapshot is invalid: ENOENT: no such file or directory, lstat '/Users/ccheever/bench-matrix-20260823-r2/instrument-corpus-hardening-20260824-v5'
```

The source configuration and migration bind this cell to that immutable v5
materialized root. The path is absent on this host. Per the campaign
instruction for an admission refusal, the conductor did not materialize a new
snapshot, change configuration, modify harness/product code, bypass admission,
or proceed to another cell.

The host load observed after the refusal was 3.92/2.20/2.22, below the inclusive
10.00 ceilings, but it is not admission evidence: the refusal occurred before
the registered three-sample minute loop.

## Retained evidence and non-attempt disposition

- No `admissions/sol-coterie-familiar.json` was created.
- No private `cells/sol-coterie-familiar` directory exists.
- No campaign host lock remains.
- No admission load sample was taken.
- No lane-controller, driver, native model, or product process was launched.
- `sol-coterie-familiar` and all four requested Grok cells remain unattempted.
- Recorded and consumed cells were not touched or rerun; no Claude cell ran on
  this host.
- No product, harness, driver, controller, configuration, or existing campaign
  record was modified.

## Required resume condition

Resume only after the exact registered `social-messenger@0.3.3-m8` snapshot is
materialized and verified at
`/Users/ccheever/bench-matrix-20260823-r2/instrument-corpus-hardening-20260824-v5`
under the landed corpus-hardening/materialization procedure. Then begin again
with a fresh scrubbed `validate-plan.mjs` invocation and a fresh three-sample
admission for `sol-coterie-familiar`. Do not rerun or mutate any recorded or
consumed cell.
