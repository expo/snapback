# Snapback 4 Clique — Astra-medium calibration on 0.2.23 (2026-09-16)

The seventh Astra-medium calibration of the LLP 3000.007 program, on `snapback4@0.2.23` / `snapback4-expo@0.2.14` (wave 7, §20.16). Packet `~/clique-sb4-20260916-astra-cal7`; ports 49360–49379; builder `gpt-6-astra` medium; independent grade by a fresh Claude Opus 5 session; holistic score by `gpt-6-astra` xhigh. N=1.

## Result

- **Builder.** M1–M6 and M8 green in 4,445 s. `run-log.md` records no confirmed Snapback defect.
- **Grade.** 88 pass, **0 fail**, 13 not run (native, waived by the prompt). O1 80 (0.2.22: 75), O2 72 (68), O4 50 (40), O5 band 75 (30). Every scale degradation rule passed with margin: 0.93×, 1.16× and 1.10× against a 3× line.
- **Holistic.** 88 (0.2.22: 91).

| Category | 0.2.19 | 0.2.21 | 0.2.22 | 0.2.23 |
| --- | ---: | ---: | ---: | ---: |
| overall | 91 | 88 | 91 | 88 |
| setup_and_docs | 92 | 90 | 90 | 92 |
| data_modeling | 88 | 88 | 89 | 85 |
| authorization | 97 | 91 | 96 | 95 |
| queries_and_live | 89 | 84 | 91 | 82 |
| writes_and_transactions | 95 | 92 | 94 | 91 |
| offline_sync | 92 | 90 | 94 | 91 |
| media_assets | 98 | 97 | 97 | 96 |
| background_work | 93 | 95 | 94 | 92 |
| client_integration | 90 | 89 | 90 | 87 |
| diagnostics_dev_loop | 95 | 93 | 90 | 92 |
| scale_and_limits | 91 | 85 | 84 | 79 |
| operations | 89 | 88 | 89 | 83 |

## What the friction review establishes

- **d-01 (major) is not a wave-7 regression.** The builder served the card's *device-held* search form from the server. In the fixture every one of 99,090 messages matches the term, and 44,100 of them are newer than the reader's newest readable row, so the 8,192-row ceiling is spent about five times before a readable row. The compiler said so from M5 onward. The product gap is that **a meter cut reaches the client as an empty success**: `complete: false` with no rows and no cursor is indistinguishable from "no matches".
- **d-05 is wave 7's deferral (W7b), and it replaced a worse behaviour:** at 0.2.22 the push never arrived. Shortening the deferral or delivering at disconnect would reopen that defect. The gap is that a deferral is invisible and hard to test.
- **queries −9 and scale −5 are narrative, not measurement.** They trace to W7a's deliberate acquisition tradeoff (1,055 → 3,095 recipe cold rows), the enlarged recipe, the search shape W7d's card invited, and a more candid final report.
- **operations −6** is entirely an `E_GENERATION` startup-adoption incident: one stderr line, then 195 silent background failures.
- **L22's major defect (an unbound `Linking.openURL`) does not reproduce** on identical code; this grader tested and passed it.

Files: `astra/FINAL.md`, `astra/grader-report.json`, the lane's final report, essay and diary, `friction-review.md`, `packet-README.md`, `PACKAGE_PINS.json`.
