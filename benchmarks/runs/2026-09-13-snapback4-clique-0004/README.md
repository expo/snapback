# Clique on Snapback 4 — full brief, three builder models

**Status: running.** Astra medium completed its continuous build at
`2026-09-13T21:10:50Z` in 9,614.013 seconds of driver wall time. Grok 4.6 xhigh
started its cold build at `2026-09-13T21:12:03Z` (PID `61926`); Muse remains queued.
All three lanes are frozen to published `snapback4@0.2.6` and
`snapback4-expo@0.2.1`. `REGISTRY_RECEIPTS.json` confirms that registry integrity
matches the exact qualified tarballs, including the platform binary.

The repairs landed at `342c53d306d7484cd64e820ee27a151e02eb4b0b`.
The publisher reran the full suite in 30 seconds: 236 Rust, 9 fixture and
89 client passes, zero failures and one declared ignored test. Its installed
consumer checks passed. `release-qualification.json` retains the package,
binary and raw-log digests. Astra reports all seven continuous milestones green; independent grading has not started.

## Frozen run

| Item | Prepared value |
| --- | --- |
| Packet | `/Users/ccheever/clique-sb4-20260913-full-3models/` |
| Instrument | 177-file read-only snapshot at `409954115f151a72dd95e897c5f00f36877f11e0` |
| Brief | unchanged full social messenger brief; nothing struck |
| Builder sequence | one continuous cold session: M1 → M2 → M3 → M4 → M5 → M6 → M8 |
| Later phases | same-family holistic score; fresh Claude Opus 5 independent grade; fresh M7 builder-family session |
| Execution | serial, foreground, on the Black M5 Max; ports 49300–49319 |
| Product access | published packages, package README, generated API, CLI guide and diagnostics only; no source-repository access or steering |
| Evidence level | N=1 per model; calibration evidence, not a magnitude claim |

| Lane | Harness | Builder | Effort | Holistic scorer |
| --- | --- | --- | --- | --- |
| astra | Codex CLI | `gpt-6-astra` | medium | Astra, xhigh |
| grok | Grok CLI | `grok-4.6` | xhigh | Grok 4.6, xhigh |
| muse | Muse Code | `muse-spark-1.3` | xhigh | Muse Spark 1.3, xhigh |

The independent grader is a fresh `claude-opus-5` session for each artifact.
That matches the September 5 grader model. Its prior CLI version was not
recorded; this packet uses Claude Code 2.1.270, which limits comparison of
grader behavior across runs.

## Results

[Astra's continuous build](./astra/README.md) is complete: M1–M6 and M8 are builder-green, and all
167,157 scale actions settled with local invariants and entity totals passing.
Its replay clock was 3,481.181 seconds after 87.819 seconds of recorded probe
exclusions (raw scale wall: 3,569 seconds). Registration honored the published
30-attempts-per-minute auth limit. The first 50% browser startup timed out;
after an application counter correction, the same-store replay resumed on the
original clock. Full-corpus cold startup later passed in 21.446 seconds.

Two strict performance predicates failed (Insights and Trending midpoint
curves). The implementation changed after the 10% checkpoint, so these are
diagnostic measurements, not a qualified uniform-code curve. Grok is building
M1; Muse, holistic scores, independent grades and fresh M7 sessions remain pending.

The [pending-shape audit](./m6-pending-shape-audit.md) separates the builder's
attribution from the documented raw-row metadata boundary. The
[replica startup audit](./replica-startup-audit.md) confirms the old quadratic
JavaScript implementation is gone and explains why whole-browser startup
timing does not identify a new device-apply defect.

| Lane | M1 | M2 | M3 | M4 | M5 | M6 | M8 | Continuous wall | Holistic score | Independent 119 | Comparable 101 subtotal | Fresh M7 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Astra medium | builder green | builder green | builder green | builder green | builder green | builder green | builder green | 9,614.013 s | pending | pending | pending | pending |
| Grok 4.6 xhigh | running | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending |
| Muse Spark 1.3 xhigh | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending | pending |

The Astra M4 builder reproduced a new [video prediction defect](../../../issues/20260913-snapback4-video-id-only-prediction-refuses.md): passing the documented asset `{ id }` fails locally when the mutation reads `.duration`. Passing the complete upload response let it continue. This is a received builder reproduction; independent grading is pending, and the published pins remain unchanged.

The frozen assertion manifest contains 119 unique IDs: 101 for M1–M7 and 18
for M8. The frozen report schema accepts the 101-ID set, so each independent
grader will write those results to `grader-report.json` and the same session's
18 M8 results to `m8-assertion-results.json`. The summary must retain the full
119 result and the comparable 101 subtotal separately. Earlier structured
grades omitted all 18 M8 IDs; their narrative comments are not a comparable
M8 assertion result.

The holistic score and complete independent grade occur before M7 because M7
changes the artifact. Each M7 run starts a fresh process using its lane's
builder model and effort.

## Prior N=1 anchors

The grade column below is limited to the prior 101 M1–M7 IDs. These are
calibration anchors only. [The prior-results dataset](./prior-results.json)
retains the exact scores, timings, methods and 32 hashed sources. The [instrument audit](./instrument-comparison.md)
confirms byte-identical September 12/current packets, while September 5 differs
in 47 shared files and adds seven current files. The brief, assertion manifest,
grader contract and scale log are unchanged, but fixture membership, UI and
choreography, evidence rules and host scheduling differ.

| Prior lane | Published product | Grade pass / fail / not-run (101) | Holistic score | M8 structured coverage | Fresh M7 |
| --- | --- | --- | ---: | --- | --- |
| Snapback 4, Astra medium | `snapback4@0.1.0` | 84 / 1 / 16 | not run | 0 / 18 reported | capability-failure, 1,386 s |
| Snapback 2, Astra medium | `snapback2@0.0.4` | 81 / 11 / 9 | 64 | 0 / 18 reported | green, 19 min |
| Snapback 2, Grok 4.6 xhigh | `snapback2@0.0.4` | 68 / 9 / 24 | 57 | 0 / 18 reported | green, 31 min |
| Snapback 2, Muse Spark 1.3 xhigh | `snapback2@0.0.4` | 75 / 17 / 9 | 78 | 0 / 18 reported | artifact green, 5 h 58 min 26 s; exceeded the 4 h safety cap |

The prior Snapback 4 builder completed every continuous milestone in 7,002
seconds. Its M7 preserved a pre-existing M1 regression and therefore closed as
a capability failure. The Muse/Snapback 2 M7 row reflects the retained-artifact
audit completed on 2026-09-13: the artifact passed, but its 21,506-second run
was not an on-budget completion.

## Execution order

Both exact npm pins are published and frozen. Packet verification passed for
all 177 instrument files and three cold lanes before launch. These foreground
commands run serially:

```sh
cd /Users/ccheever/clique-sb4-20260913-full-3models
python3 scripts/run_phase.py builder astra
python3 scripts/run_phase.py builder grok
python3 scripts/run_phase.py builder muse
python3 scripts/run_phase.py score astra
python3 scripts/run_phase.py score grok
python3 scripts/run_phase.py score muse
python3 scripts/aggregate_scores.py
python3 scripts/run_phase.py grade astra
python3 scripts/run_phase.py grade grok
python3 scripts/run_phase.py grade muse
python3 scripts/summarize_grades.py
python3 scripts/run_phase.py m7 astra
python3 scripts/run_phase.py m7 grok
python3 scripts/run_phase.py m7 muse
```

The packet's foreground runner records command, PID, start, exit, end, wall
time, stdout, and stderr for every phase. Those retained lifecycle records,
lane reports, holistic outputs, 101-ID grade files, 18-ID M8 supplements, grade
summary, and fresh-M7 reports will replace the pending cells after execution.
