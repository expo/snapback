# Astra-medium Clique calibration #24 — `snapback4@0.4.6` / `snapback4-expo@0.4.6`

**Holistic score: 89/100.** Calibrations #21, #22 and #23 scored 92, 89 and 87.

**Independent functional grade: 101 of 119 frozen assertions passed, with zero failures.**

| Milestone | Passed |
|---|---|
| M1–M5 | 79 of 79 |
| M6 | 6 of 13 |
| M7 | 0 of 9 |
| M8 | 16 of 18 |

The shortfalls are the same as in calibrations #21–#23:
- M6 `a01–a07` and M8 `a17–a18` are iOS-simulator assertions, and no simulator artifact exists. The builder produced Hermes exports only.
- M7 was not attempted.

One continuous cold Astra-medium builder ran M1–M6 and M8 on the published 0.4.6 release in **15,527 s**. Calibration #23 took 13,800 s. The scale replay settled 167,243 actions and passed its invariants. Every milestone it attempted went green. N=1: the series is fitted, not compared pairwise, and the builder's wall clock depends on host load. This run's median load was 9.0, with a peak of 129.6.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only ([FINAL.md](./astra/FINAL.md)). The goal's five categories are in bold.

| Category | cal22 (0.4.3) | cal23 (0.4.4) | **cal24 (0.4.6)** | What the scorer charged |
|---|---:|---:|---:|---|
| overall | 89 | 87 | **89** | "Replica coverage contracts added design work" |
| setup_and_docs | 93 | 91 | 90 | "scattered coverage, prediction and lifecycle contracts, and a missing integrated social-app example" |
| **data_modeling** | 88 | 84 | **87** | "M6's inherited aggregate audiences and M8's query-versus-job bounds required specialized modeling knowledge" |
| authorization | 94 | 95 | 95 | "retained former-member history required explicit held queries" |
| **queries_and_live** | 90 | 85 | **85** | "explicit server-versus-held search and complete interaction summaries for offline answers" |
| writes_and_transactions | 93 | 93 | 96 | — |
| offline_sync | 88 | 91 | 90 | "complete offline post state required additional synchronized summaries" |
| media_assets | 78 | 91 | 98 | — |
| **background_work** | 93 | 95 | **96** | — |
| **client_integration** | 87 | 82 | **85** | "explicit ownership across replica reads, transient media and online typing"; "native runtime behavior remains unproven" |
| diagnostics_dev_loop | 90 | 93 | 92 | "understanding combined client contracts still required focused replica probes" |
| **scale_and_limits** | 88 | 78 | **90** | "Insights narrowly missed its strict curve; 100/1,000-conversation web failures retain ambiguous attribution" |
| operations | 85 | 85 | 88 | "M7 … remains unevaluated" |

## What the run found in 0.4.6

1. **A send in the busy group stalls while receipts flow** (the grader's major d-01).
   - The builder's probe used the named 100-conversation user `u0500` in the 50-member, 10,000-message group.
   - The first send rendered in 0.86 s. All 49 peers' read receipts then took 21.4 s to converge, and the next send took 38.6 s to render. A later attempt failed the same way.
   - Calibration #23 failed the same probe shape. Lane SS's server-side batching did not remove the browser-side cost. Lane RG reproduces it on a copy of this run's store.
2. **The 1,000-conversation account's web acquisition** (the grader's major d-02) did not reach "offline access ready" within 90 s on this host.
   - Lane SS measured the builder's own app and store on eb1000: ready in 27–28 s either way. The default device's longest main-thread task was 7.5 s, and 75 ms with the opt-in Worker device, which is under review.
   - The 90 s timeout did not reproduce there.
3. **Coverage vocabulary.**
   - All-chat search needed a server query and a separate `held` query.
   - "Did I like this post?" could not be proven absent offline from a windowed likes sync, so the builder synced full interaction summaries.
   - A former member's retained history needed an explicit `held` query.

   Lane P19 is drafting LLP 3000.028, "One query, online or offline".
4. **Insights missed the strict mid-curve rule by 0.008 ms** (1.817 ms against a 1.809 ms limit; the grader's d-04). Search and trending passed.
5. **The native runtime was not exercised.** O4 is 30 because no simulator artifact exists, as in calibrations #21–#23.

Improvements from calibration #23 held:
- Cold replica acquisition took 2.3, 3.8 and 3.9 s at the 10%, 50% and full checkpoints; calibration #23 took 29.6 s.
- The celebrity write ratio was 1.19.
- The correction ledger attributes 0 loops to Snapback defects, 27 to agent error, 2 to the environment and 4 as ambiguous.

The grader found six defects, two major:

| Id | Severity | Summary |
|---|---|---|
| d-01 | major | Sending in the 50-member busy group from the production web client visibly stalls at the full envelope: 38.6 s and 42.4 s send/render, with no measured sample. |
| d-02 | major | The ~1,000-conversation central account's web client never reached "Offline access ready" within 90 s. |
| d-03 | minor | The lane's M5 suite is not re-runnable against a store it already exercised: its fixed group title duplicates. |
| d-04 | minor | Insights fails its mid-curve predicate by 0.4% at sub-2 ms latency. |
| d-05 | cosmetic | The quoted-reply excerpt labels the sender "Reply" instead of the original sender. |
| d-06 | cosmetic | Choreography mutates persona profiles, and the idempotent seed does not restore them. |

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260927-astra-cal24/` on the operator's M1 Max. The instrument, templates and runners are copied byte-for-byte from calibration #23; only the release pins differ ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium, 2026-09-27 23:15Z to 2026-09-28 03:33Z, 15,527.0 s, exit 0. |
| Custody | A complete clone, verified: 51,446 entries, 45,115 regular files, no missing narrative. |
| Grade | claude-opus-5, 4,617.2 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md), [M8 results](./astra/m8-assertion-results.json)). O1 78, O2 70, O3 88 (the grader wrote nine trust-boundary probes because no holdout set was committed), O4 30, O5 not scored. |
| Score | gpt-6-astra xhigh, 161.1 s, exit 0. |
| Host load | [host-load.jsonl](./host-load.jsonl): 339 samples, median 1-minute load 9.0, peak 129.6. The repository's scheduled drift backstop and Spotlight indexing ran during the build. |

The lane's Quarry program is under [astra/source/snapback](./astra/source/snapback/). Its narrative files are `astra/lane-*.md`.
