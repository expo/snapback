# R2 `opus-coterie-explicit` blocked by production-driver observation crash

Date: 2026-08-24  
Host: `charlies-macbook-pro-2`  
Disposition: **cell consumed; M1 incomplete; remaining Claude campaign continues**

`opus-coterie-explicit` ran through the landed lane controller with immutable
Claude 2.1.239 as `claude-opus-5` and harness-default effort. Its argv contained
no `--effort` option. No other R2 cell ran concurrently.

## Admission

The gate waited 1,320.113 seconds across 23 one-minute samples. The final
three samples were within the inclusive 10.00 ceiling:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 21 | `2026-08-24T19:23:44.732Z` | 4.5952 | 6.0884 | 9.6304 |
| 22 | `2026-08-24T19:24:44.736Z` | 3.3462 | 5.4487 | 9.1475 |
| 23 | `2026-08-24T19:25:44.739Z` | 3.9463 | 5.2397 | 8.8164 |

The machine-readable samples are retained at
`cells/opus-coterie-explicit/admission-samples.jsonl`
(`sha256:48bd7ca2133412731f91aa29f893e09e6c28f5ea8799f333aec12ae8cd8b2966`).

## Failure

The controller crashed during M1 with the same contradictory retry event seen
in `opus-clique-familiar`:

```text
TypeError: observation.binaryExcavation requires source-inspection
    at normalizeObservationEvent (.../metering/observations.mjs:260:15)
    at ObservationWriter.semanticAction (.../metering/observations.mjs:794:17)
    at .../metering/r2-cell-driver.mjs:352:26
```

The native session first attempted to inspect a published package through a
relative `node_modules` path, which failed, then retried from the absolute lane
root. The production driver classified the replacement as
`actionClass: "retry"` while setting `binaryExcavation: true` from its retried
`source-inspection` class. The observation schema correctly refuses binary
excavation on any event whose own action class is not `source-inspection`.

The rejected observation ran on the queued native-event path outside the lane
controller's guarded finalization flow. Node exited 1 before terminal
boundaries, the metering manifest, metering, or a complete failure-shaped
record could be written. No aggregate record was substituted.

## Retained attempt evidence

- Private cell root:
  `/Users/ccheever/bench-matrix-20260823-r2/cells/opus-coterie-explicit`
- Native session ID: `1b8090a4-5a3c-4579-b756-4d791b616fc8`
- Native stream SHA-256:
  `28557b7d2f08d44579bb0a039c0c2d40512f6cd84827d56b228d9bbee2aa889d`
- Controller observations SHA-256:
  `1cce501702aaf8a49d2d0cc15c56c1135dada63cee0a493e80dd57ac15d4e4d3`
- Record base SHA-256:
  `c942cfa50464e12194392cdfa5188419efbd3b720a01165c2783369944545397`
- Run log SHA-256:
  `b0461b467e817e49eb42177af2cac0c10b98e5196c970bb723aa851ac702e8af`

Before the crash, M1 retained 114 controller events, including 96 semantic
actions, three recovery episodes, and eight host-load samples. One sample
breached the ceiling; maxima were
`(32.0396, 14.0669, 10.7676)`. The attempt is therefore independently
scorecard-ineligible. No M1 green terminal signal was accepted; M2 and M3 did
not start.

## Teardown and continuation

The controller and Claude processes closed after the crash. The lane's run log
recorded Guide-server wrapper PID 21511 on port 42219; its exact child was
Snapback PID 21519. The conductor sent `SIGTERM` only to those two PIDs. Both
closed, no listener remains on ports 42200-42219, and no campaign Claude or
controller process remains.

This cold cell is consumed and must not be rerun. Its finalization/record
failure is retained here, and the campaign continues serially with
`opus-coterie-familiar` after a new admission gate.
