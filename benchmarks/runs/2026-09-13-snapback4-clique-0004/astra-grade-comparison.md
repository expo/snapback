# Astra grade comparison

Observed 2026-09-14T06:38:27.280263Z; revised 2026-09-14T06:41:07.743718Z. This is a read-only comparison of received grader records. All three 101-ID reports use assertion manifest `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`; all are uncalibrated N=1 grades. The JSON companion contains the prior/current status, method, evidence pointer, and classification for every one of the 101 machine-comparable IDs.

## Structured counts

| Record | Pass | Fail | Not run | Total | Comparison role |
|---|---:|---:|---:|---:|---|
| Current Snapback4 `assertionResults` | 84 | 8 | 9 | 101 | Current structured baseline |
| Prior Sep 12 Snapback4 `assertionResults` | 84 | 1 | 16 | 101 | Machine-comparable prior |
| Current M8 structured addendum | 16 | 2 | 0 | 18 | Separate current results |
| Prior Sep 5 Snapback2 `assertionResults` | 81 | 11 | 9 | 101 | Contextual prior |

Only the 101 IDs present in both Snapback4 `assertionResults` objects are pooled and compared. The Sep 12 schema omitted all 18 M8 IDs. This record does **not** reconstruct a prior 119 total, treat prior M8 prose as a structured subtotal, or pool current M8 into the exact 101 transition.

## Exact Sep 12 Snapback4 → current 101 transitions

| Transition | Count | IDs |
|---|---:|---|
| pass → pass | 83 | See `sep12Snapback4ToCurrent101.matrix` and `byId` in JSON |
| pass → fail | 1 | `m2-a07` |
| fail → pass | 1 | `m3-a11` |
| not-run → fail | 7 | `m6-a01`, `m6-a02`, `m6-a03`, `m6-a04`, `m6-a05`, `m6-a06`, `m6-a07` |
| not-run → not-run | 9 | `m7-a01`, `m7-a02`, `m7-a03`, `m7-a04`, `m7-a05`, `m7-a06`, `m7-a07`, `m7-a08`, `m7-a09` |

The two genuine pass/fail changes are:

- `m2-a07` passes in the prior grader's 3/3 live follower-count observations and fails now after three 10-second observations plus a 15-second diagnostic required reload.
- `m3-a11` failed the prior grader's independent quoted-reply jump and passes now in the builder suite plus grader-run choreography evidence.

`m6-a01`–`m6-a07` cite the absence of native simulator artifacts in both structured grades. Their not-run→fail movement is a classification change around unchanged missing proof, not evidence of seven newly regressed native behaviors. All nine M7 IDs remain not-run in the continuous graded session. The prior Sep 12 M7 capability-failure finding belongs to a separate later fresh M7 run and is not part of this baseline.

## Current M8, reported separately

The current structured addendum reports `m8-a01`–`m8-a16` pass and `m8-a17`/`m8-a18` fail. The prior report's prose says those last two native IDs were not-run because the same simulator artifacts were absent. That prose is retained only as qualitative classification context: the prior structured `assertionResults` omitted every M8 ID, so there is no exact prior M8 transition or machine-comparable prior M8 subtotal here.

## Scores and time

| Measure | Current SB4 | Sep 12 SB4 | Delta | Sep 5 SB2 | Delta |
|---|---:|---:|---:|---:|---:|
| O1 | 74 | 62 | +12 | 40 | +34 |
| O2 | 76 | 48 | +28 | 30 | +46 |
| O4 | 35 | 35 | 0 | null | — |
| O5 band | 30 | 30 | 0 | 30 | 0 |
| Builder wall seconds | 9,614.013 | 7,002 | +2,612.013 | 14,614 | -4,999.987 |

The O-dimension values are copied from each grader's own full-scope rationale; they are not calculated from a reconstructed prior 119 total. The current independent grading process exited 0 after 2,576.906 seconds. No comparable prior grader-process wall is present in `prior-results.json`. Current M7 remains not-run; the prior Sep 12 separate M7 was a 1,386-second capability failure, while Sep 5 Snapback2's separate M7 was green in 1,156 seconds. Those are separate fresh M7 artifacts, not statuses in the structured 101 baseline. September 5 timing is contextual because its instrument, scheduling, and machine contention differed.

## O4 method tension

The received O4 score is 35 and is preserved. Its report says it was “Scored only from grader-run harness receipts,” and the trace names a “Web choreography, grader-run harness.” The frozen report schema says `[choreo]` assertions are scored from harness recordings/receipts and are “never re-driven by the grader”; O4 applicability names mechanically checkable simulator choreography artifacts as its basis. The wrapper allows installing a choreography copy and the independent phase calls for browser re-execution, creating a prompt-scope tension. This record flags the tension for the host-owned full audit and does not recompute or invalidate O4.

## Evidence hashes

| Evidence | SHA-256 |
|---|---|
| `lanes/astra-snapback4/grading/grader-report.json` | `410c4cd24f4e13539692c96f4f1776fc0241d6214a163623c2591ff37a636e9f` |
| `lanes/astra-snapback4/grading/m8-assertion-results.json` | `64a9f62500f52c625576f602c8941f4d6ab7e86c4acf3cf421d58e5e29694b38` |
| `benchmarks/runs/2026-09-13-snapback4-clique-0003/grading-astra-snapback4.json` | `6938a190b797cdf4c92100d7aca0eb1fe3092882c02f1a6c7fc86f4de0b801ba` |
| `benchmarks/runs/2026-09-05-clique-full-3x3/grading-astra-snapback2.json` | `39170e2a7865d674b0740f0474c4b4370f394de302f00617313d19fb1a5df4cd` |
| `benchmarks/runs/2026-09-13-snapback4-clique-0004/prior-results.json` | `68902e4a760fa7ffd2b32a37d0399955db5d5e6ec5240d9fcf737f238423f2ae` |
| `logs/astra-snapback4.grade.start.json` | `aa175e0658cee9b18d1c2b6e591f19eb3031b1c7fb2043fd4bd5d06b5e4eba3f` |
| `logs/astra-snapback4.grade.end.json` | `dd4f3ed6145f7200286e58c49c2164893703cc731914c5068d831cdc18a4c753` |
| `instrument/grader/grader-prompt.md` | `97ce0e44d219c48b7a9dfe16ce26e9f0b90d47b00e09b43acc678cc9e2dfded6` |
| `instrument/grader/grader-report.schema.json` | `82d213374eecdbf47438193a7213dc4e8532b1a1db37204d6c21f352bfac0c30` |
| `instrument/schema/social-messenger/applicability.json` | `b3d45805202375949b657cc30609e9d1de51da6a188469e9bf2c60f8fd1e37a1` |
| `prompts/astra-snapback4.grade.md` | `54826fe2ebd30c9364b835da66cfe9537f18ecd704f015958a4780594733d8ed` |
| `lanes/astra-snapback4/grading/trace.md` | `ad54165759fc870ab0f00f4ae5a4f8b1eb084d17bab1ffc86beac38fd44f7156` |

Full source paths and exact per-ID transitions are in [`astra-grade-comparison.json`](./astra-grade-comparison.json).
