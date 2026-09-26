# Astra-medium Clique calibration #21 — `snapback4@0.4.2` / `snapback4-expo@0.4.2`

**Holistic score: 92/100**, up from 88 in calibrations #19 and #20. Independent functional grade: **101 passed of 119** frozen assertions: M1–M5 79 of 79, M6 6 of 13, M7 0 of 9, M8 16 of 18. The M6 and M8 shortfalls are iOS-simulator assertions that were not run on this host (`a01–a07`, `a17–a18`), and M7 was not attempted. The prior-101 subtotal is 85 of 101, as in calibration #20. One continuous cold Astra-medium builder ran M1–M6 and M8 on the published 0.4.2 release. The grade found no blocker or major defect.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only ([FINAL.md](./astra/FINAL.md)).

| Category | cal19 (0.4.0) | cal20 (0.4.1) | **cal21 (0.4.2)** | What the scorer charged |
|---|---:|---:|---:|---|
| overall | 88 | 88 | **92** | "replica coverage and client integration require care" |
| setup_and_docs | 87 | 88 | 96 | — |
| data_modeling | 90 | 90 | **90** | "conditional aggregate expressions and multi-column sync ordering required bounded helpers and a documented ordinal design" |
| authorization | 96 | 95 | 96 | — |
| queries_and_live | 90 | 82 | **88** | "explicit query/sync ordering requirements; an offline coverage limitation for expiry-aware unread aggregates" |
| writes_and_transactions | 96 | 94 | 98 | — |
| offline_sync | 94 | 90 | 91 | unread badges unavailable after a cold reload |
| media_assets | 97 | 97 | 99 | — |
| background_work | 96 | 96 | **98** | — |
| client_integration | 80 | 83 | **86** | "substantial explicit acquisition, prediction and settlement handling, including durable intent presentation; native evidence consists of Hermes exports" |
| diagnostics_dev_loop | 95 | 94 | 96 | — |
| scale_and_limits | 87 | 78 | **89** | "cold acquisition reached 5.602 seconds, with substantial browser RSS of 1,213.5 MiB" |
| operations | 72 | 90 | 92 | — |

What 0.4.2 answered held: bounded Following (LLP 3000.016) took the builder's cold acquisition from calibration #20's 42.3 s to 5.6 s at the scale fixture, and the scale replay settled 167,243 actions across 1,002 conversations. The builder recorded no confirmed platform blocker.

## What the run found in 0.4.2

The builder's essay, diary and run log name ten costs; [LLP 3000.019](../../../llp/3000.019-what-the-builder-still-wrote.rfc.md) records each with the builder's workaround and a proposal. In score order:

1. **Counting past a watermark** (data, scale). An unread badge over a 10,000-message conversation hit the 8,192-row read meter; the builder hand-built block counts, two views and a backfill job.
2. **Expiry-aware aggregates offline** (queries, client). A cold offline inbox lost its unread counts, and one withheld field withheld the whole row; the builder duplicated `inbox` without counts.
3. **Sync windows order by one column** (data, queries). `last 10000 by .at, .ordinal` is refused, and a query ordered differently from its window went unavailable offline with no `check` note.
4. **Reads fall back to loading** (client). Transient reloads unmounted routes and observers; the builder latched answers in refs.
5. **No list of queued writes** (client). A 105-line `Pending.ts` mirrors the outbox for an honest pending state.
6. **Delivery needs client acknowledgements** (client, scale). Observing `thread` for 100 conversations made acquisition take 69.9 s until deferred.
7. **Typing goes through the durable outbox** (queries).
8. **No row binding inside an aggregate** (data).
9. **Residency is invisible** (scale). The 1,213.5 MiB figure sums every Chromium process.
10. **Store contention** between a CLI backfill and the dev server.

Grader defects: d-01 (minor) holds that a group receipt advancing when an unread member leaves contradicts the brief. The brief's own rule, that members who leave before reaching a state drop out of the aggregate requirement, is what the lane implements, and `guide receipts` does the same; it is recorded here, not treated as a platform defect. d-02 to d-04 (cosmetic) are the lane's.

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260925-astra-cal21/` on the black M5 Max. Instrument, templates and scripts are frozen copies of cal20's; only the package pins changed ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). The host was unreachable on the network from about 03:05Z; the builder kept running. |
| Builder | gpt-6-astra medium, 2026-09-26 01:17Z to 05:34Z, 9,543.3 s, exit 0. |
| Custody | A complete APFS clone at `attempts/builder-completed`, verified: 48,833 entries, 42,553 files, no missing narrative. |
| Grade | claude-opus-5, 05:47Z to 06:46Z, 3,523.3 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md)). O1 78, O2 86, O3 null (its holdout input is absent), O4 55, O5 75. |
| Score | gpt-6-astra xhigh, 174.8 s, exit 0. |
| Host load | [host-load.jsonl](./host-load.jsonl) |

The lane's Quarry program is under [astra/source/snapback](./astra/source/snapback/), and its narrative files are `astra/lane-*.md`.
