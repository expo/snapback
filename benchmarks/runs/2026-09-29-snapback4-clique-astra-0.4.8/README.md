# Astra-medium Clique calibration #26 — `snapback4@0.4.8` / `snapback4-expo@0.4.8`

**Holistic score: 89/100.** Calibrations #23, #24 and #25 scored 87, 89 and 89.

**Independent functional grade: 100 of 119 frozen assertions passed and one failed** (m3-a02, defect d-02). M7 (9 assertions) was not run. The iOS-simulator assertions were not run: the builder produced Hermes exports only.

One continuous cold Astra-medium builder ran M1–M6 and M8 on the published 0.4.8 release in **12,080 s** (calibration #25: 14,794 s). Every attempted milestone went green without scope cuts. The run log attributes no correction loop to a Snapback defect: 39 agent errors, 4 ambiguous, 3 environment. The scale replay verified 167,243 actions. Nine of eleven builder degradation checks passed; the search and Insights midpoint checks failed. N=1: the series is fitted, not compared pairwise.

**Host.** This Mac is an M1 Max with 10 CPUs, and the builder ran 01:18–04:39Z. During the builder, this program ran only two brief read-only measurements here, each lasting seconds: a SQLite seek benchmark against calibration #25's store, and a `check`. The median 1-minute load over the run was 10.4 and the peak 74.3; the source of the peak is not attributed.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only ([FINAL.md](./astra/FINAL.md)). The goal's five categories are in bold.

| Category | cal24 (0.4.6) | cal25 (0.4.7) | **cal26 (0.4.8)** | What the scorer charged |
|---|---:|---:|---:|---|
| overall | 89 | 89 | **89** | "execution-model learning costs, and two scale checks failed" |
| setup_and_docs | 90 | 90 | 90 | M3 wanted a complete route-resolution example; schedules/jobs discoverability; the Rust/Wasm meaning of the native guide |
| **data_modeling** | 87 | 86 | **88** | "learning costs around explicit bounds, parent scopes and prediction rules" |
| authorization | 95 | 91 | 95 | — |
| **queries_and_live** | 85 | 88 | **85** | "demanding read-completeness and publication semantics … the execution model adds integration complexity" |
| writes_and_transactions | 96 | 96 | 94 | prediction sometimes needs the documented insert/update rewrite |
| offline_sync | 90 | 94 | 92 | "Native runtime durability remains unproven by Hermes exports" |
| media_assets | 98 | 97 | 97 | — |
| **background_work** | 96 | 97 | **94** | "provider deduplication and worker supervision remain application responsibilities" |
| **client_integration** | 85 | 85 | **85** | "substantial read-lifecycle integration discipline … native execution was not demonstrated" |
| diagnostics_dev_loop | 92 | 92 | 90 | "Unexplained EMPTY_READ reports remain ambiguous" |
| **scale_and_limits** | 90 | 77 | **82** | "Search and Insights midpoint limits failed. Cold sync took 12.9 seconds for 100 memberships; 1,000-conversation behavior is unproven" |
| operations | 88 | 86 | 86 | M7 migrations and production operation not exercised |

## What the run found in 0.4.8

1. **Read semantics are now the main learning cost.** The essay: "A substantial part of this build was learning exactly what a read result meant". A missing local row could mean absence, incomplete acquisition, a history boundary, a pending write, or an unavailable server fact. A transient lookup unmounted a composer, an unavailable membership disabled an offline send, and an online-only DM lookup blocked an offline reopen.
2. **The dev console flooded with `EMPTY_READ`.** The dev server printed a "dev refusal … EMPTY_READ" line for every empty query result: 14,802 lines in the milestone backend log and 55,210 during the replay. `why` had no card for it (lane DX).
3. **Worker glue is still hand-written.** The builder minted service tokens, spawned and tracked worker processes, and kept its own deduplication ledger (lane WK).
4. **The scale curves did not grow this time.** Most probes were *faster* at full scale than at 10%: history page 1 took 11.8 → 5.4 ms, and the 5-follow feed 27.2 → 12.3 ms. Calibration #25's several-fold growth is therefore not intrinsic. Lanes SQ and BP could not reproduce it on Linux, including when confined to ten CPUs. The two midpoint misses compare ten-sample maxima on flat curves.
5. **The native runtime was not exercised.** O4 is 55 (lane NP).

The grader found four defects:

| Id | Severity | Summary |
|---|---|---|
| d-01 | major | On a freshly loaded web client, the first profile save is refused with the platform's internal "the backend store is not identified yet; mutation was not admitted" instead of being deferred until the replica identifies its store. The form stays stuck until re-navigation (3 of 3 with no settle delay). |
| d-02 | major | Sender avatars in conversation bubbles never render the uploaded image (`useAsset` never reaches ready) while the same avatars render in the feed. |
| d-03 | minor | The documented acceptance entrypoint silently depends on a separately started effects worker. |
| d-04 | cosmetic | Thin margins on live two-client updates: 6 of 44 choreography attempts were rescued by best-of-3. |

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260928-astra-cal26/` on the operator's M1 Max. The instrument, templates and runners are copied byte-for-byte from calibration #25; only the release pins differ ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium, 2026-09-29 01:18Z to 04:39Z, 12,080.5 s, exit 0. |
| Custody | A complete clone, verified: 47,017 entries, 40,538 regular files, no missing narrative. |
| Grade | claude-opus-5, 04:42Z to 06:04Z, 4,943.5 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md), [M8 results](./astra/m8-assertion-results.json)). O1 80, O2 65, O4 55; O3 and O5 not scored. |
| Score | gpt-6-astra xhigh, 169.6 s, exit 0. |
| Host load | [host-load.jsonl](./host-load.jsonl): 282 samples, median 1-minute load 10.4, peak 74.3. |

The lane's Quarry program is under [astra/source/snapback](./astra/source/snapback/). Its narrative files are `astra/lane-*.md`.
