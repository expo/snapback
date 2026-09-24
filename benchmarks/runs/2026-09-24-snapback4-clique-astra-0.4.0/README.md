# Astra-medium Clique calibration #19 — `snapback4@0.4.0` / `snapback4-expo@0.4.0`

**Holistic score: 88/100.** Independent functional grade: **85 passed, zero failed, 16 not run** (seven M6 iOS-simulator assertions and nine M7 assertions). This is the first calibration on the published LLP 3000.013 forms ("Quarry states intent"). One continuous cold Astra-medium builder ran M1–M6/M8. M7 and the other builder families were not run. The grade is labelled **uncalibrated-grader** (`calibrationPassed: false`), and no holdout probe set was committed for this wave.

## Scores

Scorer: gpt-6-astra, xhigh, reading the lane's narrative files only ([FINAL.md](./astra/FINAL.md)).

| Category | cal18 (0.3.0) | **cal19 (0.4.0)** | What the scorer charged |
|---|---:|---:|---|
| overall | 92 | **88** | asset retention through `createApp`; timeline migration limits; the strict Trending midpoint miss |
| setup_and_docs | 96 | 87 | mixed feed idioms; no example of incomplete paginated observations |
| data_modeling | 87 | **90** | explicit receipt rows and helpers; prediction and completeness learning |
| authorization | 97 | 96 | — |
| queries_and_live | 90 | **90** | completeness needed explicit client handling |
| writes_and_transactions | 96 | 96 | — |
| offline_sync | 96 | 94 | native runtime unclaimed |
| media_assets | 98 | 97 | — |
| background_work | 89 | **96** | — |
| client_integration | 92 | **80** | `createApp` rejected the local client's `assets` option, so the app fell back to the lower-level client |
| diagnostics_dev_loop | 97 | 95 | — |
| scale_and_limits | 90 | **87** | the Trending midpoint rule missed by 0.011 ms on a flat curve; ambiguous feed cost |
| operations | 91 | 72 | `E_TIMELINE_REDEFINE` blocked removing a populated timeline, which forced a fresh store and a second full replay |

## What the run found in 0.4.0

The builder attributed every correction loop honestly: agent errors as agent errors, the rest as "ambiguous" (see [final report](./astra/lane-final-report.md)). These are the platform findings, each with the 0.4.1 lane that answers it:

1. **Materialized Following failed the celebrity write rule.** A post by the 900-follower author took p50 471 ms / p95 527 ms, against 3.8 / 16.6 ms for a 5-follower author ([probes](./astra/evidence/scale-extra-probes-initial.json)). The brief allows at most 3×. Background delivery held the engine lock through 256-copy chunks, and a waiting request could not take the lock. The builder moved to a read-time filter, then to an application-owned compact projection table, the derived data LLP 3000.013 had meant to remove. → **Lane L**: a FIFO engine lock and time-sliced background work. Celebrity post p95 is now 5.25 ms.
2. **A populated timeline could not be removed or redefined** (`E_TIMELINE_REDEFINE`). → **Lane L round 1**: removal retires the owned data; redefinition rebuilds in the background.
3. **`createApp` did not forward the local client's `assets` option.** → **Lane E rounds 6–9** (along with logout-fence hardening that the review of this surface found).
4. **An incomplete read was published as ready `data: null`.** It crashed `usePage` at M3 and blanked the two-device inbox at M8. The cause: a streaming unread count crossing a device horizon made the whole result unavailable, and the client published the placeholder. → **Lane J**: an unavailable answer is never data; an observation keeps its last answer as `fresh: false`; the server answers when the device cannot.
5. **First-try forms were refused:** object spread, an empty search as a directory, a seconds-based schedule period. → **Lane K** (spread, default `text` bound, mixed keys, schedule units, shape replacement) and **Lane A round 11** (optional filters, an empty search browses).
6. **The scale certificate went unused.** The README never mentions `check --cost`, so the builder timed a Trending curve that was flat within noise (1.771 / 1.770 / 1.744 ms at 10 / 50 / 100%). The "midpoint" missed by 0.011 ms, and the scorer charged it. → integration round 5: the README names the certificate as the structural proof.

## Packet and lifecycle

| Item | Record |
|---|---|
| Packet | `/Users/ccheever/clique-sb4-20260924-astra-cal19/` on the black M5 Max. Instrument, templates and scripts are frozen copies of cal18's; the only rendered change is the package pins ([pins](./PACKAGE_PINS.json), [qualification](./RUN_QUALIFICATION.json)). |
| Builder | gpt-6-astra medium. 2026-09-24 11:58:10Z to 13:52:50Z, 6,883.6 s, exit 0. M8 first green at 3,257 s. The rest was post-green scale work: the Following switch, unread-count remodelling, a second full replay, and ordered regressions. |
| Grade | claude-opus-5, 2,327 s, exit 0. |
| Score | gpt-6-astra xhigh, 163 s, exit 0. |
| Scale replay | 167,243 settled actions; 100,015 messages; 1,002 conversations; verified at 10%, 50% and final ([final verification](./astra/evidence/scale-replay-verify-final.json)). |

Lifecycle start and end records are under [lifecycle/](./lifecycle/). Host load samples are in [host-load.jsonl](./host-load.jsonl). The lane's Quarry program is under [astra/source/snapback](./astra/source/snapback/).
