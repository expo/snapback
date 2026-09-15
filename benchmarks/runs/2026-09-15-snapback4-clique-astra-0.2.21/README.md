# Snapback 4 Clique: Astra-medium calibration on 0.2.21 (2026-09-15)

The fifth Astra-medium calibration of the LLP 3000.007 program, on `snapback4@0.2.21` / `snapback4-expo@0.2.12`.
- **What the pins carry:** waves 4 (§20.13) and 5 (§20.14).
- **Packet:** `~/clique-sb4-20260915-astra-cal5`, with the same frozen instrument, scripts and templates as the 0.2.19 packet; ports 49360–49379.
- **Roles:** builder `gpt-6-astra` medium; independent grade by a fresh Claude Opus 5 session; holistic score by `gpt-6-astra` xhigh reading the lane narrative.
- **Caveat:** N=1, with same-family scoring across runs, so a few points is noise.

## Result

**Builder.** M1–M6 and M8 green, 5,140 s wall. It grouped 25 agent-error, 2 environment and 1 ambiguous correction episodes, and logged one snapback4-defect: the built-in password minimum counts bytes.

**Grade.** M1–M7: 85 pass, 0 fail, 16 not run. M8: 16 pass, 2 not run. The not-run assertions are the native artifacts (the prompt waives the simulator) and M7 (excluded by protocol).

| Dimension | Score | 0.2.19 |
| --- | --- | --- |
| O1 | 75 | — |
| O2 | 78 | 80 |
| O3 | null | — |
| O4 | 30 | 40 |
| O5 band | 75 | — |

O2's defects: 5 minor, 1 cosmetic.

**Holistic.** 88 (0.2.19: 91).

| Category | 0.2.12 | 0.2.16 | 0.2.19 | 0.2.21 |
| --- | ---: | ---: | ---: | ---: |
| overall | 86 | 90 | 91 | 88 |
| setup_and_docs | 79 | 96 | 92 | 90 |
| data_modeling | 89 | 85 | 88 | 88 |
| authorization | 94 | 88 | 97 | 91 |
| queries_and_live | 80 | 91 | 89 | 84 |
| writes_and_transactions | 94 | 96 | 95 | 92 |
| offline_sync | 90 | 93 | 92 | 90 |
| media_assets | 97 | 97 | 98 | 97 |
| background_work | 88 | 91 | 93 | 95 |
| client_integration | 91 | 88 | 90 | 89 |
| diagnostics_dev_loop | 78 | 94 | 95 | 93 |
| scale_and_limits | 86 | 88 | 91 | 85 |
| operations | 87 | 88 | 89 | 88 |

`friction-review.md` finds no regression from waves 4–5. The drops trace to three kinds of cause.

**Unchanged Snapback items this builder surfaced or described more bluntly:**
- The password minimum counts bytes, with no policy setting (authorization −6).
- The builder again declined the Following recipe for a global-timeline filter: 4.31× before the fix, where the 0.2.19 run measured 4.37× (queries_and_live −5, scale −6).

**One diagnostics gap:** "predicts: eligible" hides main-path horizon guards (diagnostics −2).

**The builder's own design choices,** such as an intent ledger for idempotent retries (writes −3), plus scorer variance.

**Closed and used this run:**
- no web navigation write loss;
- `dev --replay`;
- reaction first-insert prediction;
- sync on open;
- the dense-query spellings;
- `clock advance`;
- calendar offsets;
- the Metro `blockList`.

**Not used:** `init --recipe feeds` (likely because its tables collide with the app's own), the Trending recipe (for its one-minute lag), and `client.acquired` / `usePendingWrite`.

**Files:**
- `astra/FINAL.md` (scores);
- `astra/grader-report.json`;
- the lane's final report, essay and diary;
- `friction-review.md`;
- `packet-README.md`;
- `PACKAGE_PINS.json`.
