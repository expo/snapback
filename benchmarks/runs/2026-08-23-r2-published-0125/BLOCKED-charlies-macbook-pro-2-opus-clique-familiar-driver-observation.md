# R2 `opus-clique-familiar` blocked by production-driver observation crash

Date: 2026-08-24  
Host: `charlies-macbook-pro-2`  
Disposition: **cell consumed; M1 incomplete; remaining Claude campaign continues**

`opus-clique-familiar` passed a fresh admission gate and launched through the
landed lane controller with the immutable Claude 2.1.239 executable. Claude ran
as `claude-opus-5` with harness-default effort: the argv contained no
`--effort` option. No other R2 cell ran concurrently.

## Admission

The launch-authorizing gate passed in the minimum three one-minute samples:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 1 | `2026-08-24T18:49:43.315Z` | 7.0059 | 5.6494 | 8.5034 |
| 2 | `2026-08-24T18:50:43.325Z` | 5.2886 | 5.3926 | 8.2114 |
| 3 | `2026-08-24T18:51:43.331Z` | 3.4751 | 4.8115 | 7.7983 |

The machine-readable launch samples are retained at
`cells/opus-clique-familiar/admission-samples-launch.jsonl`
(`sha256:6d76385148b30b6e775f7daaf6692f1bfa1ac79548547bc6b1a809c4bb14fa73`).
The earlier 23-sample window in `admission-samples.jsonl` belongs to the
pre-migration validation block and did not authorize this launch.

## Failure

The controller crashed during M1 while decoding a native tool retry:

```text
TypeError: observation.binaryExcavation requires source-inspection
    at normalizeObservationEvent (.../metering/observations.mjs:260:15)
    at ObservationWriter.semanticAction (.../metering/observations.mjs:794:17)
    at .../metering/r2-cell-driver.mjs:352:26
```

The triggering native action inspected the published
`node_modules/@expo/snapback-react` package after a prior source-inspection
command failed. The driver classified the successful replacement action as
`actionClass: "retry"` but independently set `binaryExcavation: true` from the
retried class. The observation schema permits binary excavation only when the
event itself is `actionClass: "source-inspection"`, so the writer correctly
refused the contradictory event.

The rejected observation ran on the driver's queued native-event path outside
the lane controller's guarded milestone/finalization flow. The Node process
exited 1 before `driver.finalize()` could stamp terminal boundaries, a metering
manifest, metering, or a failure-shaped complete record. This is a production
driver lifecycle defect as well as an observation-shape defect; no aggregate
record was hand-authored in its place.

## Retained attempt evidence

- Private cell root:
  `/Users/ccheever/bench-matrix-20260823-r2/cells/opus-clique-familiar`
- Native session ID: `ae2c1191-2f0c-49c2-87fe-659e4d8d5fd7`
- Native stream SHA-256:
  `d3e931e0f7650d45bc6f9d323100655af62559f6a562633e4f473dbce5545718`
- Controller observations SHA-256:
  `77c279f477b7850d7bce2b3afeaf5012f3c475b8ce386139799fd0f055a11ace`
- Record base SHA-256:
  `494527e2dcded106373e26beee58c5532bc75063f78a7bd03ccd94fc915e9d7d`
- Run log SHA-256:
  `10323ef418acf74aa6e2e135d835cc2dfa0dec417e73e1599ed9857a311cd654`

Before the crash, M1 retained 100 controller events, including 81 semantic
actions, two recovery episodes, and ten host-load samples. One sample breached
the ceiling (`loadavg-1 = 11.6826`), so this attempt is independently
scorecard-ineligible. No M1 green terminal signal was accepted; M2 and M3 did
not start.

## Teardown and continuation

The controller and Claude processes closed after the crash. The lane had
recorded its temporary Guide server as wrapper PID 8862 and native Snapback PID
8890 on port 42199; the conductor sent `SIGTERM` only to those exact PIDs. Both
closed, no listener remains on ports 42180-42199, and no campaign Claude or
controller process remains.

This cold cell is consumed and must not be rerun. Per campaign rules, the
finalization/record failure is retained in this blocked report and execution
continues serially with `opus-coterie-explicit` after a new admission gate.
