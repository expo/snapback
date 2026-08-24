# R2 `opus-coterie-familiar` blocked during record finalization

Date: 2026-08-24  
Host: `charlies-macbook-pro-2`  
Disposition: **cell consumed; M1-M3 product-green; scorecard-ineligible; no aggregate record**

`opus-coterie-familiar` ran through the landed lane controller with immutable
Claude 2.1.239 as `claude-opus-5` and harness-default effort. Its argv contained
no `--effort` option. No other R2 campaign cell ran concurrently.

## Admission

The gate waited approximately 360.038 seconds across seven one-minute samples.
The final three samples were within the inclusive 10.00 ceiling:

| Sample | UTC | loadavg-1 | loadavg-5 | loadavg-15 |
| --- | --- | ---: | ---: | ---: |
| 5 | `2026-08-24T19:41:04.616Z` | 4.0815 | 8.4775 | 9.7056 |
| 6 | `2026-08-24T19:42:04.620Z` | 4.2778 | 7.6982 | 9.3267 |
| 7 | `2026-08-24T19:43:04.624Z` | 3.0654 | 6.7456 | 8.8589 |

The machine-readable samples are retained at
`cells/opus-coterie-familiar/admission-samples.jsonl`
(`sha256:c6c6eda45a85940b673ad82da1fe5a17a2da967b34584c39220294b040aacb2e`).

## Retained product findings

All three milestone signals were accepted as product-green, with hash-bound
suite and choreography evidence:

| Milestone | Accepted signal UTC | Suite | Choreography |
| --- | --- | --- | --- |
| M1 | `2026-08-24T20:42:19.486Z` | green (7/7) | green |
| M2 | `2026-08-24T21:39:30.684Z` | green (22/22) | green |
| M3 | `2026-08-24T22:34:53.514Z` | green (7/7) | green |

The retained observation stream has 639 events: 405 semantic actions, eight
recovery episodes, and 176 host-load samples. By milestone, it records M1 as
259 actions/seven recoveries, M2 as 65 actions/one recovery, and M3 as 81
actions/no recoveries. The private lane also completed `diary.md`, `essay.md`,
and `final-report.md` before its M3 signal.

## Finalization failure

After the native Claude session completed successfully, the production
controller generated terminal boundaries and a metering manifest, then failed
closed before writing `metering.json` or `record.json`:

```text
social-messenger lane controller: M1 observation semantic-action is after its terminal boundary
```

The generated M1 boundary uses the suite/choreography pass time
`2026-08-24T20:41:27.846Z` as `terminalAt`. The controller observation stream
then contains a normal M1 `process` semantic action at
`2026-08-24T20:41:27.940Z` (sequence 342), followed by the remaining signal
preparation actions through sequence 345. The controller did not accept the M1
signal until `2026-08-24T20:42:19.486Z`. The finalizer therefore rejects an
event that occurred during the legitimate interval between the evidence pass
and the accepted controller signal. M2 and M3 have the same early-boundary
shape, but validation stops at the first M1 violation.

The fixed aggregate-token checksum was not reached, so no token aggregate is
claimed as validated. The native stream ends in a successful Claude result,
but it is retained only as raw evidence. No hand-authored aggregate or
failure-shaped `record.json` was substituted.

## Contamination and retained hashes

The cell is independently scorecard-ineligible from host load. Ninety-one of
176 samples breached at least one ceiling, with maxima
`(149.0874, 113.9951, 73.0073)` for the 1-, 5-, and 15-minute averages. The
observation stream also contains three chained native-harness API error events.
That is retained as raw API-interruption contamination; because finalization
did not produce normalized interruption windows, this report does not invent a
canonical aggregate API flag.

- Private cell root:
  `/Users/ccheever/bench-matrix-20260823-r2/cells/opus-coterie-familiar`
- Native session ID: `07e82e3b-0d8d-4a70-b607-54ea56c14fc1`
- Native stream SHA-256:
  `7ad005df21c48c64e4a080337d45c16f709adf69bbb8a58cbd40cc77a7484ed6`
- Controller observations SHA-256:
  `f63a114470fc99653e1a4b8e375ea30424d47a164107983209fbbe9d4f0495fa`
- Cell milestones SHA-256:
  `a75ca9e19fa45a7b38c339e25f245b72e6567a90c81cd251c288ca87b6567b4f`
- Terminal boundaries SHA-256:
  `d9c9d66e926f63aec3bc3d28ec7184c9f4ffee0a24d8cafeb142945d5d911c13`
- Metering manifest SHA-256:
  `e1ec5b7b8f094073cdabcd6fe454facd36e05e7e33d61f5f66207aa92528b270`
- Record base SHA-256:
  `547624c4784a324e4fd6e39e8be61ebb7b759c9daca742a62e4058e31049946e`
- Run log SHA-256:
  `f79c802b8b794f556339a794bb5ff7cd63ea8b3205d7b2f5c3026c49179feeb9`

## Teardown

The native session self-reported one safety-rule violation: it used
`pkill -f 'vite-cli.mjs'` once while restarting its private web server. The
violation remains in the native stream and `run-log.md`; it was not erased or
used as a reason to rerun the cell. Subsequent web lifecycle operations used
explicit PID tracking.

The controller and Claude processes closed after finalization failed. One
cell-owned Exact/Vite process tree remained on port 42222. The conductor
resolved that exact tree by PID, parentage, lane working directory, and
listener, then sent `SIGTERM` only to PIDs 38583, 38582, and 38579. All three
closed, no listener remains on ports 42220-42239, and no campaign Claude or
controller process remains.

This cold cell is consumed and must not be rerun. Its M1-M3-green product
findings remain useful, but the cell has no valid aggregate record and is
excluded from the efficiency scorecard.
