# Astra-medium Clique calibration #22 — `snapback4@0.4.3` / `snapback4-expo@0.4.3`

**Holistic score: 89/100.** Calibrations #19 and #20 scored 88 and #21
scored 92.

**Independent functional grade: 101 of 119 frozen assertions passed, with
zero failures.**

| Milestone | Passed |
|---|---|
| M1–M5 | 79 of 79 |
| M6 | 6 of 13 |
| M7 | 0 of 9 |
| M8 | 16 of 18 |

The shortfalls match calibration #21 exactly. M6 `a01–a07` and M8
`a17–a18` are iOS-simulator assertions that were not run on this host, and
M7 was not attempted. The prior-101 subtotal is 85 of 101.

One continuous cold Astra-medium builder ran M1–M6 and M8 on the published
0.4.3 release in **5,808 s** (calibration #21 took 9,543 s). Every milestone
it attempted went green. N=1: the series is fitted, not compared pairwise,
and the builder's wall clock depends on host load.

## The mechanism 0.4.3 added: ephemeral tables (LLP 3000.017)

This was registered in the packet before launch: "the mechanism claim is
m3-a06/m3-a07 passing with no typing correction loop that attributes
lateness to the backend, and the builder declaring `ephemeral` found through
the guide."

- **Found through the guide.** At M3's start the builder read
  `guide ephemeral` (`evidence/guide-ephemeral.txt`, run log line 28). Its
  typing table declares `ephemeral 4s`, with the card's membership conjunct
  on `update` ([schema.q](./astra/source/snapback/schema.q)). Nothing
  outside the published package told it the feature existed.
- **m3-a06 and m3-a07 pass** under the independent grader. Typing was
  visible **44.5 ms** after the last keystroke, against a 2 s bound. It
  expired **4,061 ms** after the last keystroke, against 5 s, with all three
  attempts inside the bound. The scorer credits `queries_and_live` 90 with
  "M3 live receipts and ephemeral typing … worked through declared queries
  and generated hooks".
- **One typing correction loop, and the platform shares it** (run log line
  36). The builder attributed it to agent error: "redundant acknowledgements
  at every observer mount kept ephemeral reads loading during sync".
  - On the local-first tier, a durable commit to `members`, a table the
    typing query's rule probes, re-runs the watch through the device's
    `unknown` placeholder. That publishes `{ loading: true }` until the
    server answers.
  - A typing indicator therefore flickers off during unrelated durable
    writes. One mid-M3 choreography attempt missed the 2 s bound in all
    three trials (`evidence/m3-choreo-attempt3.jsonl`).
  - The builder avoided it by removing redundant writes. The platform should
    keep the last server answer instead. Ticket:
    [`issues/20260926-snapback4-ephemeral-watch-loading-flicker.md`](../../../issues/20260926-snapback4-ephemeral-watch-loading-flicker.md).

Before 0.4.3, typing went through the durable outbox. Calibration #21's
LLP 3000.019 item 7 ("Typing goes through the durable outbox") and the
0.4.1 comparative's typing failures recorded the cost of that.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only
([FINAL.md](./astra/FINAL.md)).

| Category | cal20 (0.4.1) | cal21 (0.4.2) | **cal22 (0.4.3)** | What the scorer charged |
|---|---:|---:|---:|---|
| overall | 88 | 92 | **89** | — |
| setup_and_docs | 88 | 96 | 93 | — |
| data_modeling | 90 | 90 | 88 | "Optional narrowing, list construction, and job sweep bounds" |
| authorization | 95 | 96 | 94 | — |
| queries_and_live | 82 | 88 | **90** | — |
| writes_and_transactions | 94 | 98 | 93 | — |
| offline_sync | 90 | 91 | 88 | "Some intents required durable presentation" |
| media_assets | 97 | 99 | **78** | "M2's compiler-accepted image list failed authorized downloads with E_ASSET_UNKNOWN, requiring four scalar slots: an explicit snapback4-defect" |
| background_work | 96 | 98 | 93 | — |
| client_integration | 83 | 86 | 87 | "Completeness and pending states needed explicit" handling |
| diagnostics_dev_loop | 94 | 96 | 90 | — |
| scale_and_limits | 78 | 89 | 88 | "Repeated p95/degradation testing was unclaimed" |
| operations | 90 | 92 | 85 | "M7 was" not run |

## What the run found in 0.4.3

1. **A list of images compiles, but its assets are never placed.** This is
   a platform defect (media), and it predates 0.4.3.
   - `[image <=N] <=K` passes `check`, and upload ids are stored in the row.
   - An authorized recipient's `GET` returns `404 E_ASSET_UNKNOWN`, because
     placement does not follow list elements (`evidence/media-probe.txt`).
   - The builder used four scalar image columns and rebuilt the list in a
     shape.
   - This one finding cost the `media_assets` category 21 points against
     calibration #21.
   - Ticket:
     [`issues/20260926-snapback4-image-list-assets-never-placed.md`](../../../issues/20260926-snapback4-image-list-assets-never-placed.md).
2. **Ephemeral watches flicker to loading on the local-first tier** during
   durable writes. See above.

The grader found five defects, all minor or cosmetic, and none in typing or
ephemeral state:

- d-01: Trending's incomplete answer is rendered as "no results".
- d-02: the Feed route mounts the whole Chats list above it.
- d-03: the M6 acceptance needs a running push worker, and that is
  undocumented.
- d-04: `API.md` never names a failed mutation's `why`.
- d-05: an expired disappearing message could render at the instant of a
  loaded relaunch.

d-05 touches durable expiry, not ephemeral tables. It is recorded here and
not ticketed on this evidence alone.

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260926-astra-cal22/` on the black M5 Max. The instrument, templates and five runner/aggregator scripts are byte-identical copies of calibration #21's. Only the builder launcher's docstring and `runPurpose` differ ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium, 2026-09-26 12:05Z to 13:41Z, 5,808.4 s, exit 0. |
| Custody | A complete APFS clone at `attempts/builder-completed`, verified: 44,516 entries, 38,290 files, no missing narrative. |
| Grade | claude-opus-5, 13:44Z to 14:56Z, 4,327.9 s, exit 0 ([report](./astra/grader-report.json), [trace](./astra/trace.md), [M8 results](./astra/m8-assertion-results.json)). O1 74, O2 84, O3 null (its holdout input is absent), O4 65, O5 null. |
| Score | gpt-6-astra xhigh, 140.5 s, exit 0. |
| Host load | [host-load.jsonl](./host-load.jsonl): 172 samples, median 1-minute load 18, peak 235. Other sessions shared the host. |

The lane's Quarry program is under
[astra/source/snapback](./astra/source/snapback/). Its narrative files are
`astra/lane-*.md`.
