# Astra-medium Clique calibration #20 — `snapback4@0.4.1` / `snapback4-expo@0.4.1`

**Holistic score: 88/100**, the same as calibration #19. Independent functional grade: **85 passed, 7 failed, 9 not run** of 101. The seven failures are the M6 iOS-simulator assertions, which were not run on this host, and the nine not run are M7. One continuous cold Astra-medium builder ran M1–M6 and M8 on the published 0.4.1 release. The grade is labelled **uncalibrated-grader**.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only ([FINAL.md](./astra/FINAL.md)).

| Category | cal19 (0.4.0) | **cal20 (0.4.1)** | What the scorer charged |
|---|---:|---:|---|
| overall | 88 | **88** | "Following's rejected acquisition bound and constrained backfill prevent an ideal fit" |
| setup_and_docs | 87 | 88 | no integrated guide to cold acquisition, navigation and durable admission |
| data_modeling | 90 | **90** | "Quarry's smaller vocabulary as less familiar and more restrictive than ordinary server functions" |
| authorization | 96 | 95 | — |
| queries_and_live | 90 | **82** | "Following's 1,000-event backfill limit and full-source-sync requirement; `E_TIMELINE_SHAPE` rejected bounded acquisition" |
| writes_and_transactions | 96 | 94 | — |
| offline_sync | 94 | 90 | 500-message initial acquisition per conversation; offline readiness needs completed acquisition |
| media_assets | 97 | 97 | — |
| background_work | 96 | **96** | — |
| client_integration | 80 | **83** | "acquisition, admission and online fallback as demanding integration boundaries; M8 needed readiness UX" |
| diagnostics_dev_loop | 95 | 94 | — |
| scale_and_limits | 87 | **78** | "cold multi-route browser flow took 42.324 seconds; required full public sync and rejected acquisition bounds remain material" |
| operations | 72 | 90 | — |

Every 0.4.1 answer to calibration #19 held:
- the builder kept the materialized Following view, and nothing in the run records a slow write;
- `createApp` carried `assets`;
- no read published `data: null`;
- no view was blocked from removal;
- the README's certificate was used.

The builder recorded **zero established platform-defect loops**: 19 agent errors, 2 ambiguous, 2 environment.

The new charge is one design limit, on three categories. Materialized Following requires its sources to be fully synced public data. So every cold device acquires all 50,228 public posts before its feed is complete offline, and a new follower receives only the newest 1,000 events of each author. The builder's `sync public last 5000 by .at` on posts was refused with `E_TIMELINE_SHAPE` ([check](./astra/evidence/check-bounded-posts.log)).

## What the run found in 0.4.1

1. **Following acquisition** (scorer: queries 82, scale 78, client 83). → [LLP 3000.016](../../../llp/3000.016-following-on-a-bounded-device.rfc.md), draft: bounded or `online only` sources, device pages answered from held cards with the server fallback past the horizon, and no history window.
2. **Cold start and readiness UX** (scorer: client 83, setup 88). The builder wrote its own acquisition gate and online-fallback timer. → lane V: `useAcquisition()`, a paved recipe, and measured acquisition speed.
3. **A hard navigation lost an admin click** before admission (builder, M3). The client promises a synchronous localStorage journal. → lane V finds out why it did not hold here and fixes it.
4. **The web client's Following projection missed an unfollow** (grader d-02, major). After the second and third viewer-repost-of-an-unfollowed-author cycle in one session, the author's original appeared as a bare card; the server's projection was exact. A device defect in the Following view. → a fix lane.
5. **A periodic ~28 ms read stall** (grader d-09). Every 20-read probe batch had one read of about 28–31 ms, which put p95 at 28 ms against a 3–5 ms p50. An independent re-measurement found 1.09×. → investigated separately.

Grader defects d-01 (a repeated media pick wedges the composer), d-03 (a stale M4 receipt), d-05 to d-08 and d-10 are the application's or the harness's, not the platform's.

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260924-astra-cal20/` on the black M5 Max. Instrument, templates and scripts are frozen copies of cal19's; the only rendered change is the package pins ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium, 2026-09-25 04:06Z to 06:09Z, 7,390.6 s, exit 0. First greens: M1 at 13 minutes, M3 at 49, M6 at 79, M8 at 108. |
| Grade | claude-opus-5, 3,744.8 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md)). |
| Score | gpt-6-astra xhigh, 162.7 s, exit 0. |
| Scale replay | 167,157 of 167,157 actions settled in 510 s on its own clock, with invariants verified at 10%, 50% and final ([receipt](./astra/evidence/scale-receipt.json)). |
| Host load | [host-load.jsonl](./host-load.jsonl) |

The lane's Quarry program is under [astra/source/snapback](./astra/source/snapback/), and its narrative files are `astra/lane-*.md`.
