# Muse grade comparison

Observed 2026-09-14T08:04:19.558946Z. This is a read-only comparison of received public grader records. Both use the same 101 assertion IDs and manifest version `0.3.0-m8`; the current report binds the frozen manifest as `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04`, while the prior report leaves its manifest hash null. Both are uncalibrated N=1 grades. The JSON companion preserves result, method, suite result, evidence, and note for every machine-comparable ID.

## Structured counts

| Record | Pass | Fail | Not run | Not applicable | Total |
|---|---:|---:|---:|---:|---:|
| Current Snapback 4 `assertionResults` | 79 | 13 | 8 | 1 | 101 |
| Prior Sep 5 Snapback 2 `assertionResults` | 75 | 17 | 9 | 0 | 101 |
| Current M8 structured addendum | 15 | 3 | 0 | 0 | 18 |

Only the shared 101 IDs are pooled. The prior structured report omitted M8, so this comparison does not reconstruct a prior 119 total or pool current M8 into the 101 result.

## Exact 101 transitions

| Transition | Count | IDs |
|---|---:|---|
| fail → fail | 8 | See `structured101Transition.matrix` and `byId` in JSON |
| fail → pass | 9 | `m2-a22`, `m2-a23`, `m5-a06`, `m5-a09`, `m5-a11`, `m6-a08`, `m6-a09`, `m6-a10`, `m6-a12` |
| not-run → not-applicable | 1 | `m7-a09` |
| not-run → not-run | 8 | See `structured101Transition.matrix` and `byId` in JSON |
| pass → fail | 5 | `m2-a20`, `m3-a13`, `m5-a01`, `m5-a02`, `m5-a03` |
| pass → pass | 70 | See `structured101Transition.matrix` and `byId` in JSON |

Five prior passes are current failures: `m2-a20`, `m3-a13`, `m5-a01`, `m5-a02`, `m5-a03`. Nine prior failures are current passes: `m2-a22`, `m2-a23`, `m5-a06`, `m5-a09`, `m5-a11`, `m6-a08`, `m6-a09`, `m6-a10`, `m6-a12`. Eight M7 assertions remain not-run. `m7-a09` changes from not-run to not-applicable because the current grader records its conditional prerequisite as unmet; that is a classification difference, and current M7 itself remains pending.

## Current M8, separate

The current addendum reports 15 pass and 3 fail. The three failures are `m8-a05`, `m8-a17`, `m8-a18`. There is no structured prior M8 subtotal or exact M8 transition.

## Scores and time

| Measure | Current SB4 | Prior Sep 5 SB2 | Delta |
|---|---:|---:|---:|
| O1 | 30 | 30 | +0 |
| O2 | 40 | 25 | +15 |
| O4 | null | null | — |
| O5 band | 0 | 30 | -30 |
| Same-family holistic total | 80 | 78 | +2 |
| Builder wall seconds | 17,657.686 | 29,693 | -12,035.314 |

The current builder driver ran 17,657.686 seconds and exited 130. The receipt retains the actual SIGINT outcome: public terminal completion occurred at least three times, while runtime-managed background sessions continued empty turns. The prior 29,693-second wall covers attempt 2 only; the provider-outage attempt 1 is excluded rather than pooled.

The current independent grader exited 0 after 2,312.379 seconds. No comparable prior grader-process runtime is retained. The prior separate M7 artifact is green at 21,506 seconds but exceeded its 14,400-second cap; current M7 is still pending.

The holistic totals are same-family narrative scores and remain separate from independent assertion grading. September 5 wall and score comparisons are contextual because its instrument, environment, parallel scheduling, and machine contention differed.

## Evidence hashes

| Evidence | SHA-256 |
|---|---|
| `lanes/muse-snapback4/grading/grader-report.json` | `e4e031cc1757c0a892fd172c9b232588cba2118db6ed55eabd3f6ab517893f88` |
| `lanes/muse-snapback4/grading/m8-assertion-results.json` | `6cc08be217d09b86a57d24ff787f25cdd7bbf6dc8b922cf940c94e6a3af5c030` |
| `/Users/ccheever/clique-full-20260905/lanes/muse-snapback2/grading/grader-report.json` | `0a9979296ad123da2e5c30ff961cde7e86d8d1946fad5c77c5846c2e62a64165` |
| `benchmarks/runs/2026-09-13-snapback4-clique-0004/prior-results.json` | `68902e4a760fa7ffd2b32a37d0399955db5d5e6ec5240d9fcf737f238423f2ae` |
| `logs/muse-snapback4.start.json` | `980b3c552a2e5ed5840493c694634091cff559a42fbec867705c033b5aa70b22` |
| `logs/muse-snapback4.end.json` | `b1e1aba56798930e8118481d692355855c1cb4e6349c1f170be0cff64d142b28` |
| `observed-milestones/muse-background-loop-interruption.json` | `5443afd335811bbbec64dd61d9f55b34448a840305abe9c4234de87ed92c2405` |
| `logs/muse-snapback4.grade.start.json` | `a6d563bd4229bddba78ed8d15ddcee324628d2f8477454881331d3f8bd65e2bc` |
| `logs/muse-snapback4.grade.end.json` | `ad05a9b37c26edf38fd2ec6a5f846392b9db5aafa3ad906c04ff002146fdce4e` |
| `scores/all.json` | `c4ca5b3c0c2b899adfa1c7ec8e7533e74a2f19e08c1431c366bdad20d6d3e9d8` |
| `benchmarks/runs/2026-09-05-clique-full-3x3/holistic-scores.json` | `fcba924f03a745d58ee9aa0e8468cafe3aa448bc0e32c3d3ec1064e5c3537df5` |
| `instrument/schema/social-messenger/assertions.json` | `e15c3952856148fef9872f9d509159b47fe0066bdca904330ae96196ba732d04` |
| `benchmarks/runs/2026-09-13-snapback4-clique-0004/instrument-comparison.md` | `98fd367c8e97bd527251de017f8578cb83908bd4d3efc6dd7fdb1c0a224be45a` |

Full source paths, all 101 per-ID records, method transitions, M8 results, category scores, and qualifications are in [`muse-grade-comparison.json`](./muse-grade-comparison.json).
