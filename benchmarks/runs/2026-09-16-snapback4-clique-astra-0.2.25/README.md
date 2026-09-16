# Snapback 4 Clique — Astra-medium calibration on 0.2.25 (2026-09-16)

The ninth Astra-medium calibration of the LLP 3000.007 program, on `snapback4@0.2.25` / `snapback4-expo@0.2.16` (wave 9, §20.18). Packet `~/clique-sb4-20260916-astra-cal9`; ports 49360–49379; builder `gpt-6-astra` medium; independent grade by a fresh Claude Opus 5 session; holistic score by `gpt-6-astra` xhigh. N=1.

## Result

- **Builder.** Every in-scope milestone green in 4,901 s, with **zero Snapback defects** recorded: 17 agent errors and two environment corrections. No `E_STRUCTURAL_FANOUT`, no `N_WIDE_MERGE`, and a two-note final check.
- **Grade.** 85 pass, **0 fail**, 16 not run. O1 75, O2 **78** (0.2.24: 75), O4 10, O5 null. All four defects are minor.
- **Holistic.** **91** (0.2.24: 88) — the program's best, matching 0.2.19 and 0.2.22.

| Category | 0.2.22 | 0.2.23 | 0.2.24 | 0.2.25 |
| --- | ---: | ---: | ---: | ---: |
| overall | 91 | 88 | 88 | **91** |
| setup_and_docs | 90 | 92 | 90 | 85 |
| data_modeling | 89 | 85 | 88 | 88 |
| authorization | 96 | 95 | 95 | 96 |
| queries_and_live | 91 | 82 | 78 | **86** |
| writes_and_transactions | 94 | 91 | 95 | 95 |
| offline_sync | 94 | 91 | 93 | 95 |
| media_assets | 97 | 96 | 96 | 98 |
| background_work | 94 | 92 | 92 | 96 |
| client_integration | 90 | 87 | 88 | 89 |
| diagnostics_dev_loop | 90 | 92 | 94 | 94 |
| scale_and_limits | 84 | 79 | 80 | **87** |
| operations | 89 | 83 | 86 | 88 |

## What the friction review establishes

**No wave-9 regression.** Confirmed wins: `unique … else HANDLE_TAKEN` closes the 0.2.24 run's d-05 verbatim; residency sites are 285/285 located (they were 62/318 synthetic); `N_MAINTAIN_SYNCED`'s structurally-zero count is gone, 14 → 0.

**setup_and_docs 90 → 85 is the README split,** which came from another session, not wave 9. `README.md` still tells a reader "There is no other documentation" while half the surface now sits in `CLIENT-AND-OPERATIONS.md`; the builder logged that file as a separate lookup twice.

**queries 78 → 86 and scale 80 → 87 were mostly the builder,** which wrote the card's paved 50-lane membership search instead of the previous run's 1,000-lane merge, deleting both wide-merge charges at source, and measured cold sync itself (8,290 ms). Wave 9's held-completeness line printed in five checks but the lane never cites it; `Read.cut` contributed nothing.

**O4 45 → 10 and a null O5 are instrument:** the same absent simulator leg read below an anchor rather than between anchors, and this grader declining the previous run's `otherwise` branch.

**The largest remaining Snapback item is discoverability.** `why <CODE>`, wave 9's headline, was invoked zero times, and `guide reads` went unopened for a second consecutive run, so `Read.cut` and the dev meter are unconsumed twice over.

Files: `astra/FINAL.md`, `astra/grader-report.json`, the lane's final report, essay and diary, `friction-review.md`, `packet-README.md`, `PACKAGE_PINS.json`.
