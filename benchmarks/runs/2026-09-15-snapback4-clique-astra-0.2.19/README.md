# Snapback 4 Clique: Astra-medium calibration on 0.2.19 (2026-09-15)

This is the fourth Astra-medium calibration of the LLP 3000.007 program.
- **Pins:** `snapback4@0.2.19` / `snapback4-expo@0.2.10`, which is §20 wave 3 as published (§20.12). The two mechanisms descoped at the review-round limit are absent; wave 4 shipped later as 0.2.20.
- **Packet:** `~/clique-sb4-20260915-astra-cal4`, with the same frozen instrument, scripts and templates as the 0.2.16 packet, on ports 49360–49379.
- **Roles:** builder `gpt-6-astra` medium; independent grade by a fresh Claude Opus 5 session; holistic score by a `gpt-6-astra` xhigh session reading only the lane narrative.
- **Caveat:** N=1, with same-family scoring across runs, so a few points is noise.

## Result

- **Builder.** M1–M6 and M8 green in 6,334 s wall (machine load around 20–24). The builder counted 28 grouped correction episodes: 25 its own errors, 2 environment, 1 ambiguous. It recorded "0 demonstrated snapback4 defects".
- **Grade.** M1–M7: 84 pass, 1 fail (m5-a11, DM grouping, an app bug), 16 not run. M8: 16 pass, 2 not run. The not-run assertions are the native simulator artifacts (the run prompt waives simulator proofs) and all of M7, which is not run by protocol.
  - O1 72 (0.2.16: 75).
  - O2 80 (55). No blocker or major defects: 3 minor and 3 cosmetic.
  - O3 null (no probe set was committed).
  - O4 40 (10). The web offline receipts were credited.
  - O5 band 75.
- **Holistic.** 91 (0.2.16: 90).

| Category | 0.2.12 | 0.2.16 | 0.2.19 |
| --- | ---: | ---: | ---: |
| overall | 86 | 90 | 91 |
| setup_and_docs | 79 | 96 | 92 |
| data_modeling | 89 | 85 | 88 |
| authorization | 94 | 88 | 97 |
| queries_and_live | 80 | 91 | 89 |
| writes_and_transactions | 94 | 96 | 95 |
| offline_sync | 90 | 93 | 92 |
| media_assets | 97 | 97 | 98 |
| background_work | 88 | 91 | 93 |
| client_integration | 91 | 88 | 90 |
| diagnostics_dev_loop | 78 | 94 | 95 |
| scale_and_limits | 86 | 88 | 91 |
| operations | 87 | 88 | 89 |

`friction-review.md` extracts the evidence behind these numbers and ranks next-wave candidates.

**Gains.** Authorization and data_modeling recovered (+9, +3) with owner-only tombstones and the 0.2.17 maintains.

**Closed since 0.2.16:**
- the `N_NO_CURSOR` false note
- the missing guide aliases
- the CommonJS generated-API import
- the internal site paths in notes

**Snapback-attributable friction that remains.** The small drops trace to these:
- **Web write lost on navigation (S29, third run).** Fixed in 0.2.20 by W4a.
- **Replay holds effects but does not suppress them.** Yet the cards say replay needs no app flag.
- **Following recipe declined.** The builder chose a read-time merge instead, and it failed 4.37× at scale.
- **Trending over an expiring window.** It needs a hand-built online-only `ranked` table, so `like` never predicts.
- **Offline first reaction.** A membership-scoped `upsert` never predicts its first reaction offline (grader d-06), while `check` calls it eligible.
- **Open before acquisition.** Opening online does not wait for acquisition.
- **Stale docs.** A sentence still describes a reverted batch route.

**Shipped but not adopted.** The dev clock (W3d) shipped, but the builder still waited 185 s of real time.

**Files.**
- `astra/FINAL.md`: scores.
- `astra/grader-report.json`.
- The lane's final report, essay and diary.
- `friction-review.md`.
- `packet-README.md`.
- `PACKAGE_PINS.json`.
