# Snapback 4 Clique — Astra-medium calibration on 0.2.22 (2026-09-15)

This is the sixth Astra-medium calibration of the LLP 3000.007 program, on `snapback4@0.2.22` / `snapback4-expo@0.2.13` (wave 6, §20.15).
- **Packet:** `~/clique-sb4-20260915-astra-cal6`, with the same frozen instrument as the earlier packets; ports 49360–49379.
- **Roles:** builder `gpt-6-astra` medium; independent grade by a fresh Claude Opus 5 session; holistic score by `gpt-6-astra` xhigh.
- **Caveat:** N=1, so a few points is noise.

## Result

**Builder.** M1–M6 and M8 green in 4,852 s wall. There were 13 correction entries (11 agent, 2 environment) and no Snapback defect was attributed. The builder adopted every wave-6 fix directly:
- it installed `init --recipe feeds --prefix` at the start of M2;
- it declared `use identity password`;
- its replay and seed scripts pass `mutate(op, args, { id })`.

Its final check has 2 notes; the 0.2.21 run had 16.

**Grade.** 85 pass, 7 fail, 9 not run.
- **O1 75**, unchanged at 101/119.
- **The 7 fails** are the native simulator assertions m6-a01..a07. The prompt waives simulator proofs, and the previous grader recorded the same missing evidence as not-run.
- **O2 68** (0.2.21: 78). Its one major defect, d-01, is an app bug: an unbound `Linking.openURL`.
- **O4 40.**
- **O5 band 30** (75). One mid-curve timing rule missed: Trending at 50% measured 1.915 ms against a 1.832 ms line, on a flat curve.

**Holistic.** 91 (0.2.21: 88).

| Category | 0.2.12 | 0.2.16 | 0.2.19 | 0.2.21 | 0.2.22 |
| --- | ---: | ---: | ---: | ---: | ---: |
| overall | 86 | 90 | 91 | 88 | 91 |
| setup_and_docs | 79 | 96 | 92 | 90 | 90 |
| data_modeling | 89 | 85 | 88 | 88 | 89 |
| authorization | 94 | 88 | 97 | 91 | 96 |
| queries_and_live | 80 | 91 | 89 | 84 | 91 |
| writes_and_transactions | 94 | 96 | 95 | 92 | 94 |
| offline_sync | 90 | 93 | 92 | 90 | 94 |
| media_assets | 97 | 97 | 98 | 97 | 97 |
| background_work | 88 | 91 | 93 | 95 | 94 |
| client_integration | 91 | 88 | 90 | 89 | 90 |
| diagnostics_dev_loop | 78 | 94 | 95 | 93 | 90 |
| scale_and_limits | 86 | 88 | 91 | 85 | 84 |
| operations | 87 | 88 | 89 | 88 | 89 |

**Where Snapback is still at fault** (`friction-review.md`):
- **d-03:** a prefixed recipe install leaves its standalone mutations client-callable, so they accept arbitrary post ids. This is a wave-6 (W6a) regression.
- **d-02:** the 35 s presence grace means a message arriving just after the last client disconnects is never pushed.
- **Recipe residency:** it costs prediction for profile, post and follow writes.
- **Trending:** it still widens write rules.
- **SDK reads:** they carry no work meter.
- **Search:** there is no paved form for search across more than 50 chats.
- **`dev --fresh`:** its banner does not say "in memory".

d-04 is the known repost-check harness race (V5). d-05 is the lane's own README.

**Files:**
- `astra/FINAL.md`
- `astra/grader-report.json`
- the lane's final report, essay and diary
- `friction-review.md`
- `packet-README.md`
- `PACKAGE_PINS.json`
