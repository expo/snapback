# R2 campaign resume blocked by frozen instrument digest drift on `charlies-mac-mini--durand`

**Status:** Blocked before the second Codex cell; no new benchmark cell was started.
**Observed:** 2026-08-24 11:19 PDT (2026-08-24T18:19Z)
**Campaign runner revision:** `11843cbef4dfd31028c3be29abe88659851dfe87`
**Next cell:** `sol-clique-familiar`
**Instrument:** `social-messenger@0.3.3-m8`

## Blocking condition

The required three-minute admission gate passed. The landed
`validate-plan.mjs` was then run before starting the cell, as required by the
published final rulings, and exited 1:

```text
Error: instrument artifact recordValidator digest mismatch at tools/social-messenger/record-validator.mjs
    at resolveInstrumentArtifacts (.../benchmarks/tools/lane-setup.mjs:208:13)
    at .../benchmarks/runs/2026-08-23-r2-published-0125/validate-plan.mjs:172:28
```

The frozen instrument manifest and R2 harness config both bind
`benchmarks/tools/social-messenger/record-validator.mjs` at
`fa1b179a617db743ec15d9d87017458e594cab070b798ccd72b5349ccf373238`.
After the landed repairs `a4ad07029` and `7b828efca`, the file digest is
`6083bf88cf29feac9e625093b5bc026377c644c7a963195f920cc6b17edcd727`.
The manifest still hashes to the preregistered
`8a13dcc55eca1dfe49a13d704575d2e2843ca059c34c964df86c7287dfb729ad`.

This is a fail-closed instrument/production-path validation break. Starting
the lane despite it would bypass the required pre-cell validator and run
against bytes outside the frozen instrument closure. The conductor did not
edit the manifest, harness config, validator, driver, controller, product
code, or the finalized `sol-clique-explicit` cell.

## Admission evidence

Three consecutive one-minute samples were within the inclusive 10.00 ceiling:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 1 | 2026-08-24T18:16:39.488Z | 6.5474 | 8.8354 | 7.8184 |
| 2 | 2026-08-24T18:17:39.492Z | 3.5874 | 7.5957 | 7.4238 |
| 3 | 2026-08-24T18:18:39.496Z | 2.8774 | 6.6538 | 7.0801 |

The machine-readable samples are retained at
`cells/sol-clique-familiar/admission-samples.jsonl`.

## Attempt and teardown disposition

- `sol-clique-familiar` remains `not-started`; no `record.json` exists.
- No lane-controller, R2 cell-driver, campaign Codex/Grok process, or listener
  on ports 42020–42039 was present after the validation failure.
- `sol-coterie-explicit`, `sol-coterie-familiar`, and all four Grok cells
  remain `not-started`.
- No Claude cell was touched.
- `sol-clique-explicit` remains exactly as finalized at `11843cbef`; it was not
  modified or rerun.

## Required resume condition

Resume only after the repaired record validator and the complete metering
directory are deliberately rebound into a versioned instrument closure, the
R2 harness configuration is reconciled to that approved closure, and the
landed `validate-plan.mjs` can validate a resumed wave without requiring the
already-finalized first cell to be pristine. Then begin again with a fresh
three-sample admission window for `sol-clique-familiar`; do not treat the
window retained here as admission for a later start.
