# Astra-medium Clique calibration #23 — `snapback4@0.4.4` / `snapback4-expo@0.4.4`

**Holistic score: 87/100.** Calibrations #21 and #22 scored 92 and 89.

**Independent functional grade: 101 of 119 frozen assertions passed, with
zero failures.**

| Milestone | Passed |
|---|---|
| M1–M5 | 79 of 79 |
| M6 | 6 of 13 |
| M7 | 0 of 9 |
| M8 | 16 of 18 |

The shortfalls match calibrations #21 and #22 exactly:
- M6 `a01–a07` are iOS-simulator assertions, and no simulator artifact
  exists. The builder produced Hermes exports only.
- M7 was not attempted.

One continuous cold Astra-medium builder ran M1–M6 and M8 on the published
0.4.4 release in **13,800 s**. Calibration #22 took 5,808 s. Of that, M8's
scale replay and its supplemental probes took 1 h 35 min.

Every milestone it attempted went green. N=1: the series is fitted, not
compared pairwise, and the builder's wall clock depends on host load.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only
([FINAL.md](./astra/FINAL.md)). The goal's five categories are marked.

| Category | cal21 (0.4.2) | cal22 (0.4.3) | **cal23 (0.4.4)** | What the scorer charged |
|---|---:|---:|---:|---|
| overall | 92 | 89 | **87** | — |
| setup_and_docs | 96 | 93 | 91 | "the M6 token-mint discrepancy" |
| **data_modeling** | 90 | 88 | **84** | "bounded ordinal probes instead of an expiring-row scan, and Following adoption had to precede source events" |
| authorization | 96 | 94 | 95 | — |
| **queries_and_live** | 88 | 90 | **85** | "answer completeness and replacement required explicit handling" |
| writes_and_transactions | 98 | 93 | 93 | — |
| offline_sync | 91 | 88 | 91 | "native restart behavior remains unverified" |
| media_assets | 99 | 78 | **91** | "four scalar image slots worked around documented image-list offline limitations" |
| **background_work** | 98 | 93 | **95** | — |
| **client_integration** | 86 | 87 | **82** | "the answer lifecycle required stable interaction owners and bounded display continuity"; "native runtime was not exercised" |
| diagnostics_dev_loop | 96 | 90 | 93 | "compilation alone did not establish meaningful query completeness at scale" |
| **scale_and_limits** | 89 | 88 | **78** | "search/trending midpoint rules failed … acquisition evidence covers 100 conversations, leaving 1,000-conversation behavior unestablished" |
| operations | 92 | 85 | 85 | "M7 migrations/backfills and hosted recovery were untested" |

## What the run found in 0.4.4

1. **Answers flash `loading` on every update, even with `keep: true`.**
   - 0.4.4's app facade withdrew every replaced answer until an asynchronous
     authority check returned (`d654838f65`).
   - Screens unmounted mid-interaction: onboarding at M1, the conversation
     and a clicked quote at M3, a long-press and a video viewer at M4,
     settings at M5. The DM screen called `createDm` four times in a burst.
   - At M8 the builder hand-built "a bounded one-second display buffer" for
     delivered-history metadata.
   - The grader's d-04: follower-count projection, profile edit, typing and
     the quote jump each passed only on their best of three attempts.
   - Answered by lane KG and [LLP 3000.023](../../../llp/3000.023-answers-stay-on-screen.rfc.md)
     (Accepted). Every watch keeps its answer through a re-read for at most
     one second, marked `revalidating`.
2. **Global search at scale.**
   - The builder's first all-chat search returned `data: []`,
     `complete: false`, no `cut` and no `next` after examining one row: a
     dead end.
   - Rewritten to the guide's membership form, it completed, but with 11 MB
     of heap, 10.17 MB of it repeated per-hit decoration.
   - Lane GS reproduced both on a copy of this run's store: the private
     authorization walk exhausted after skipping 44,101 unreadable hits. The
     membership form cannot resume discovery past one read's examined
     ceiling (LLP 3000.024, a draft on lane GS's branch).
3. **A device at scale.** Both are lane SS's.
   - Cold acquisition of 100 memberships took 29.56 s against the probe's
     30 s timeout (the grader's d-03).
   - In a 50-member group, a live message sent from another client never
     rendered within 30 s (the grader's major d-01).
4. **Minting a service token while dev runs.** The services card says to
   mint "after starting its dev server", but `snapback4 token` against a
   store a live server owns refuses `E_STORE_BUSY`. Lane TK.
5. **The native runtime was not exercised.** O4 is 30 because no simulator
   artifact exists; the builder exported Hermes bundles only, as in
   calibrations #21 and #22.

The grader found six defects, one major:

| Id | Severity | Summary |
|---|---|---|
| d-01 | major | The 50-member group send-and-render probe timed out at full scale; the search and trending midpoint growth rules failed. |
| d-02 | minor | M6's acceptance entrypoint needs a separately launched push worker. |
| d-03 | minor | Cold-start sync of 100 conversations used 98.5% of its 30 s ceiling. |
| d-04 | minor | Several two-client live updates pass only best-of-3. |
| d-05 | cosmetic | The lane's own tests hard-code fixture passwords. |
| d-06 | cosmetic | After a recipient consumes a view-once photo, the sender can still fetch its bytes. |

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260926-astra-cal23/` on the operator's M1 Max. The instrument, templates and runners are calibration #22's; only the release pins differ ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium, 2026-09-27 03:54Z to 07:44Z, 13,800.2 s, exit 0. |
| Custody | A complete clone, verified: 52,902 entries, 46,483 regular files, no missing narrative. |
| Grade | claude-opus-5, 2,676.9 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md), [M8 results](./astra/m8-assertion-results.json)). O1 78, O2 70, O3 null (no holdout set), O4 30, O5 band 30. |
| Score | gpt-6-astra xhigh, 172.5 s, exit 0. |
| Host load | [host-load.jsonl](./host-load.jsonl): 285 samples, median 1-minute load 8.7, peak 59.6. |

The lane's Quarry program is under
[astra/source/snapback](./astra/source/snapback/). Its narrative files are
`astra/lane-*.md`.
