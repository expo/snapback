# Astra-medium Clique calibration #27 — `snapback4@0.4.9` / `snapback4-expo@0.4.9`

**Holistic score: 90/100.** Calibrations #24, #25 and #26 scored 89.

**Independent functional grade: 101 of 119 frozen assertions passed, none failed, 18 not run.** Nine of the not-run assertions are M7, which this lane never attempts. The other nine are the iOS-simulator native-artifact assertions (m6-a01..a07, m8-a17, m8-a18). The builder produced Hermes exports and a Release artifact but ran no simulator proof. The grader found no blocker or major defect.

One continuous cold Astra-medium builder ran M1–M6 and M8 on the published 0.4.9 release in **12,178 s** (calibration #26: 12,080 s). Every attempted milestone went green without scope cuts, and the run log attributes no correction loop to a Snapback defect.

The first builder launch exited at once, before any session started, because the lane instrument links copied from calibration #26 still pointed at that packet. The links were repointed and the builder relaunched; `attempts/failed-launch-20260930T0300/` in the packet keeps the record.

**Host.** The author's M1 Max (10 CPUs). The builder ran 03:01–06:24Z; [host-load.jsonl](./host-load.jsonl) holds 276 samples, median 1-minute load 8.9, peak 59.9. The repository's scheduled drift and local-proof backstops ran during parts of the build.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only ([FINAL.md](./astra/FINAL.md)). The goal's five categories are in bold.

| Category | cal25 (0.4.7) | cal26 (0.4.8) | **cal27 (0.4.9)** | What the scorer charged |
|---|---:|---:|---:|---|
| overall | 89 | 89 | **90** | "Quarry learning, manual receipts, and replica-lifetime ergonomics kept the experience below ideal" |
| setup_and_docs | 90 | 90 | 95 | — |
| **data_modeling** | 86 | 88 | **87** | learning Quarry expressions, indexes and prediction constraints; M3 receipts needed explicit ordinals, delivered runs, read positions and membership accounting |
| authorization | 91 | 95 | 96 | — |
| **queries_and_live** | 88 | 85 | **86** | "asynchronous Following acquisition, server-read decorations, and explicit partial coverage … replica answer lifetimes as an integration cost" |
| writes_and_transactions | 96 | 94 | 95 | — |
| offline_sync | 94 | 92 | 95 | native runtime unverified |
| media_assets | 97 | 97 | 98 | — |
| **background_work** | 97 | 94 | **97** | — (supervised push effects, provider idempotency, scheduled digests with every client closed) |
| **client_integration** | 85 | 85 | **86** | "Replica loading/withdrawal and subscription ownership demand care" |
| diagnostics_dev_loop | 92 | 90 | 89 | "missing subscription-pressure inspection" |
| **scale_and_limits** | 77 | 82 | **90** | "Cold restart retained 100 conversations, leaving 1,000 unproven. Three midpoint misses remain unattributed" |
| operations | 86 | 86 | 89 | M7 migrations not exercised |

## What the run found in 0.4.9

1. **Cold acquisition is fast now.** Five cold acquisitions of the 100-conversation probe account took 1.1–4.7 s (calibration #26: 12.9 s), with a 28.6 MB wasm heap. All 100 conversations stayed available after an offline restart. The celebrity write ratio was 1.42×.
2. **Background work met the goal.** Supervised workers with an injected token and a completion ledger replaced the hand-written worker glue of earlier runs.
3. **Subscription pressure is the new read-lifecycle cost.** In the M8 dual-offline convergence check, both devices briefly rendered empty histories while many overlapping subscriptions revalidated ("first=0 second=0"). The check passed only after the builder reduced subscriptions to active-screen-only feed reads and paged decorations. The essay asks for "a simpler built-in diagnostic view of subscription pressure".
4. **Receipts are still hand-modelled.** "I would welcome a higher-level recipe or reusable schema for this common pattern, provided it preserved the underlying authority rules."
5. **The midpoint rule still misses.** Three builder checks failed the instrument's mid-curve rule (search, Insights, Trending) while every ratio passed. The builder notes that its final probes were faster than its earlier checkpoints, which were taken during replay load.

## Grader defects

| Id | Severity | Summary |
|---|---|---|
| d-01 | minor | A consumed view-once photo shows as unopened again after a page reload on the recipient's client. |
| d-02 | minor | API.md documents the inbox row's `peer` as a DM-only field, but two-member groups set it too. |
| d-03 | minor | The run record omits the `performanceProbes` block O5 is scored from. |
| d-04 | cosmetic | Search group headers show a placeholder title while a chat's title loads. |
| d-05 | cosmetic | Two acceptance scripts hard-code a fixture password instead of reading the persona file. |
| d-06 | cosmetic | Feed infinite scroll misses one large programmatic jump (100 ms scroll throttle). |

O-dimension scores ([grader-report.json](./astra/grader-report.json)):
- O1 78: every executed assertion passed; below 90 because of the native-artifact assertions and M7.
- O2 84: no majors (calibration #26: 65).
- O3 88: from grader-authored trust-boundary checks; no holdout probe set was committed.
- O4 65: calibration #26 scored 55.
- O5 not scored: the run record lacked the probe block (d-03).

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260929-astra-cal27/` on the operator's M1 Max. The instrument, templates and runners are copied byte for byte from calibration #26; only the release pins differ ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium, 2026-09-30 03:01Z to 06:24Z, 12,178.0 s, exit 0 ([lifecycle](./lifecycle/)). |
| Custody | A complete clone, verified: 49,655 entries, 43,063 regular files, no missing narrative. |
| Grade | claude-opus-5, 06:26Z to 07:39Z, 4,399.6 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md), [M8 results](./astra/m8-assertion-results.json)). |
| Score | gpt-6-astra xhigh, 173.6 s, exit 0. |
| Host load | [host-load.jsonl](./host-load.jsonl): 276 samples, median 1-minute load 8.9, peak 59.9. |

The lane's Quarry program is under [astra/source/snapback](./astra/source/snapback/). Its narrative files are `astra/lane-*.md`.
