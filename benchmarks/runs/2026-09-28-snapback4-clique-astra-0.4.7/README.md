# Astra-medium Clique calibration #25 — `snapback4@0.4.7` / `snapback4-expo@0.4.7`

**Holistic score: 89/100.** Calibrations #22, #23 and #24 scored 89, 87 and 89.

**Independent functional grade: 101 of 119 frozen assertions passed.** No assertion that the builder's artifacts could exercise failed.

| Milestone | Passed |
|---|---|
| M1–M5 | 79 of 79 |
| M6 | 6 of 13 |
| M7 | 0 of 9 (not run) |
| M8 | 16 of 18 |

The shortfalls have the same cause as in calibrations #21–#24: M6 `a01–a07` and M8 `a17–a18` are iOS-simulator assertions, and no simulator artifact exists (the builder produced Hermes exports only), while M7 was not attempted. This grader recorded the seven M6 simulator assertions as **fail** where calibration #24's recorded them as not run; the artifact state is the same.

One continuous cold Astra-medium builder ran M1–M6 and M8 on the published 0.4.7 release in **14,794 s** (calibration #24: 15,527 s). The scale replay settled 167,157 actions with zero failed actions and passed its invariants. Every milestone it attempted went green. N=1: the series is fitted, not compared pairwise.

**Host contamination.** From 09:22 to about 10:37Z, while the builder worked M1–M4, another session rehearsed the 0.4.8 native publication steps on this Mac: a first simulator boot of the iOS 26.5 runtime and a 40-minute cold Expo release build. The 1-minute load reached 564; the median over the whole run was 8.6. Early milestone wall times are contaminated. The scale phase (about 12:10–13:10Z) ran at loads of 7–11.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only ([FINAL.md](./astra/FINAL.md)). The goal's five categories are in bold.

| Category | cal23 (0.4.4) | cal24 (0.4.6) | **cal25 (0.4.7)** | What the scorer charged |
|---|---:|---:|---:|---|
| overall | 87 | 89 | **89** | "language constraints, client conceptual overhead, and two failed scale measurements" |
| setup_and_docs | 91 | 90 | 90 | "headless auth discoverability and connecting separate coverage/prediction guides required extra synthesis" |
| **data_modeling** | 84 | 87 | **86** | "unfamiliar Quarry spellings and restricted aggregate/reference forms; M6 required representative child rows plus complete aggregate keys" |
| authorization | 95 | 95 | 91 | "M6's E_READ_THROUGH_SCAN constraint made private aggregate projections less natural" |
| **queries_and_live** | 85 | 85 | **88** | "held data and complete answers require distinct UI handling"; a failed search mid-curve measurement |
| writes_and_transactions | 93 | 96 | 96 | — |
| offline_sync | 91 | 90 | 94 | "partial coverage and writes without predicted rows require explicit presentation" |
| media_assets | 91 | 98 | 97 | — |
| **background_work** | 95 | 96 | **97** | — |
| **client_integration** | 82 | 85 | **85** | "substantial hook, coverage, and custody learning. Native runtime remains unproven" |
| diagnostics_dev_loop | 93 | 92 | 92 | "M4's online-only reaction wording needed additional rules-guide interpretation" |
| **scale_and_limits** | 78 | 90 | **77** | "Search and Insights missed mid-curve ceilings; 1,000-conversation behavior was not demonstrated" |
| operations | 85 | 88 | 86 | "CLI writes required stopping the backend"; M7 unassessed |

## What the run found in 0.4.7

1. **No major defect.** Calibration #24's two majors did not recur as grader defects: the busy-group send stall (lane RG's fix is not in 0.4.7) was not reproduced by this builder's probes, and the 1,000-conversation web account was not measured.
2. **Two mid-curve rules missed at the 50% checkpoint** (d-03, minor): global message search p95 16.33 ms against a 15.19 ms interpolated ceiling (7% over), and Insights p95 5.01 ms against 4.26 ms. The other eight degradation checks passed; deep paging 1.04x, 500-follow feed 2.89x, celebrity read 0.69x and write 1.01x.
3. **A fresh browser acquired the 100-conversation user `u0500` in 11.6 s**, with offline inbox and newest history coverage (calibration #24 measured 14.1 s).
4. **Aggregate projections.** `E_READ_THROUGH_SCAN` refused a private per-message totals projection, and the builder restructured (lane MP, landing for 0.4.8, admits the parent-pinned form).
5. **The native runtime was not exercised.** O4 is 55.

The grader found five defects, none major:

| Id | Severity | Summary |
|---|---|---|
| d-01 | minor | The M8 acceptance suite's backend restart reads a PID file that the documented start command never writes. |
| d-02 | minor | The M6 acceptance suite silently requires a separately launched push worker. |
| d-03 | minor | Search and Insights miss their mid-curve degradation ceilings at the 50% checkpoint. |
| d-04 | cosmetic | A non-member's history read returns an empty page rather than a refusal (no data leaks; by design, reads of hidden rows are empty). |
| d-05 | cosmetic | `posts.removed` is declared and read, but no mutation sets it. |

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260928-astra-cal25/` on the operator's M1 Max. The instrument, templates and runners are copied byte-for-byte from calibration #24; only the release pins differ ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium, 2026-09-28 09:11Z to 13:17Z, 14,794.5 s, exit 0. |
| Custody | A complete clone, verified: 45,307 entries, 38,979 regular files, no missing narrative. |
| Grade | claude-opus-5, 2,744.5 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md), [M8 results](./astra/m8-assertion-results.json)). O1 76, O2 84, O3 88 (the grader wrote a trust-obligation sweep because no holdout set was committed), O4 55, O5 not scored. |
| Score | gpt-6-astra xhigh, 158.3 s, exit 0. |
| Host load | [host-load.jsonl](./host-load.jsonl): 425 samples, median 1-minute load 8.6, peak 564.5 (the publication rehearsal described above). |

The lane's Quarry program is under [astra/source/snapback](./astra/source/snapback/). Its narrative files are `astra/lane-*.md`.
