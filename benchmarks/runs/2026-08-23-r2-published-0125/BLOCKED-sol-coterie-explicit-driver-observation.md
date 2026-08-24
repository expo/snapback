# R2 campaign blocked by production-driver observation crash

**Status:** Campaign stopped during `sol-coterie-explicit` M1; no later cell
was started.
**Observed:** 2026-08-24 13:06 PDT (2026-08-24T20:06Z)
**Campaign runner revision:** `3d7341517ea6d76b24367e48e4f4a49922da41ac`
**Cell:** `sol-coterie-explicit`
**Driver:** `social-messenger-r2-native-cli-driver.v1`
**Instrument:** `social-messenger@0.3.3-m8`

## Blocking condition

The exact registered lane-controller command crashed in M1 with an uncaught
typed-observation exception:

```text
TypeError: observation.binaryExcavation requires source-inspection
    at normalizeObservationEvent (.../metering/observations.mjs:260:15)
    at ObservationWriter.record (.../metering/observations.mjs:745:19)
    at ObservationWriter.semanticAction (.../metering/observations.mjs:794:17)
    at LaneObservationHarness.semanticAction (.../metering/observations.mjs:938:24)
    at Object.semanticAction (.../metering/lane-controller.mjs:301:52)
    at .../metering/r2-cell-driver.mjs:352:26
```

This is a production-driver defect. In `r2-cell-driver.mjs`, a retry changes
the emitted `actionClass` from the classified command kind to `retry`, while
`binaryExcavation` is still computed from the original
`source-inspection` classification and a `node_modules`/harness-path match.
The landed observation contract correctly requires
`binaryExcavation=true` only when the emitted action class itself is
`source-inspection`. The crashing native event was the start of a retry-shaped
`rg` inspection beneath `node_modules/@expo/snapback-*` after an earlier failed
source-inspection episode.

The failure escaped the queued observation promise rather than flowing through
the controller's caught cell/finalization path. No failure-shaped record was
written. This meets the campaign's explicit **driver broken: report and stop**
condition. The driver, controller, validator, instrument, and product code were
not modified.

## Admission and plan validation

The fresh admission gate passed three consecutive minute-separated samples:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 1 | 2026-08-24T19:34:21.247Z | 2.6680 | 1.8442 | 1.9360 |
| 2 | 2026-08-24T19:35:21.251Z | 2.1152 | 1.8262 | 1.9185 |
| 3 | 2026-08-24T19:36:21.252Z | 2.1475 | 1.8608 | 1.9233 |

The frozen repaired runner then ran the landed `validate-plan.mjs` successfully
before prompt delivery. The committed admission evidence is
`cells/sol-coterie-explicit/admission-samples.jsonl`
(`sha256:af6b9febc606eadfd2bd89a363f2aa5a09432221f0707c898d1d23ec5583176f`).

## Retained attempt evidence

The private attempt remains on this host at:

```text
/Users/ccheever/bench-matrix-20260823-r2/cells/sol-coterie-explicit
```

The crash occurred before any M1 terminal signal or suite/choreography receipt.
Consequently, `events/cell-milestones.jsonl`, `suite-status.json`,
`terminal-boundaries.json`, `metering-manifest.json`, `metering.json`, and
`record.json` do not exist. No substitute record was fabricated and this
attempt must not be rerun.

Key retained source digests are:

| Retained source | SHA-256 |
| --- | --- |
| `events/harness.stdout.jsonl` | `63935574a3ea3203852ff5ce9d1ed457f4456a1c1148838cc608f2802299969e` |
| `events/harness.stderr.log` | `6aec73b483323c4a61b3fedab36246dde3e4537e84bcf2fa17040e7c387f546b` |
| `events/lane-controller-observations.jsonl` | `16af3de8fe9d746e23f03fe217ce77a9c9235fe8475b65408180f0d00ffea5b6` |
| `record-base.json` | `3c7d2413f6e7d170abcc8b34fd6dba96019f742b881ae76b9854abcfcfb09865` |
| `rendered-prompt.md` | `0595f9443a8e64c955e22b73effa36c660cd736ffb35c500f507af51d6b34126` |
| `run-log.md` | `f4b99a02c2369e8e05e77c83268ff4bbe067b4ef67e08b5d4d949db7f752cb9f` |

The retained streams contain 261 native harness events, 154 valid controller
observations, and 30 host-load samples. Two samples breached the ceiling; the
maxima were 11.0479 / 6.5571 / 4.5986, so the attempt was already
`host-load-contamination` and scorecard-ineligible. The sole API observation
was the successful native-cell launch; no provider interruption window was
recorded.

## Teardown and stopped cells

After the crash, no campaign Codex process, lane-controller, or listener on
ports 42040–42059 remained. The earlier finalized `sol-clique-explicit` cell
was not touched. `sol-coterie-familiar` and all four Grok cells remain
unstarted. No Claude cell was run. Campaign execution must not resume until a
landed driver repair makes the retry/binary-excavation combination valid and
the governing resume conditions are explicitly re-established.
