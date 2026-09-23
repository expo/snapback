# Astra-medium Clique calibration #17 — `snapback4@0.2.33` / `snapback4-expo@0.2.24`

**Holistic score: 92/100. Independent functional grade: 101 passed, zero
failed, 18 not run.** The continuous cold builder completed at 03:58:37 UTC
on September 23, 2026; independent grading finished at 04:55:44 UTC. The
strict search midpoint rule failed, yielding objective performance band 30.
The nine missing native-artifact assertions and nine M7 assertions remain unrun.

This is the corrective-release rerun commissioned under
[LLP 3000.011](../../../llp/3000.011-recent-builder-friction.research.md).
It follows the initial 0.2.32 run and the three native media repairs found by
the actual-app extension. It is not the separate program's preregistered
first-0.3 benchmark. That program's predictions, source changes and private
designs were not supplied to this builder or scorer.

## Packet and scope

| Item | Record |
| --- | --- |
| Public packages | `snapback4@0.2.33`, `snapback4-darwin-arm64@0.2.33`, `snapback4-expo@0.2.24`; registry integrity checked against qualified artifacts before launch. |
| Published source | `f54b4c71dea34a428739199d25e09a301d06e988`; later changes on main are outside this release. |
| Instrument | The same 179 files from `30fea66c9b20dbea50e6d8444a61c2cd9ca3c787`; manifest SHA-256 `89b8c59d734334c015eaed025a52488e4c6266aabd40e21ade6a75ffd35381d2`. |
| Templates | Manifest SHA-256 `33e54d45d451400c38d9e1f738ebcd0181b0fc6c8fbf97de60e4fc15033b0f2e`; the five runner scripts and five templates are unchanged from cal16. |
| Measured lane | One continuous fresh Astra medium build, M1–M6 and M8. M7 and other model builder lanes are unrun. |
| Independent sessions | The frozen protocol uses Opus 5 for grading and Astra xhigh for read-only holistic scoring. Product implementation used Astra xhigh; its design/code reviews used Grok 4.7 xhigh and Astra max. |
| Builder lifecycle | 02:36:32–03:58:37 UTC on September 23; exit 0, 4,924.230 seconds by the external runner. The builder separately records an internal 4,890-second clock. |
| Builder usage | 33,016,405 input tokens, including 32,514,560 cached input tokens; 129,501 output tokens. Actual completion event and log digest are retained in [builder usage](./lifecycle/builder-usage.json). |
| Holistic score | Astra xhigh, 04:01:58–04:04:42 UTC, exit 0, 164.094 seconds. All 12 actual tool calls were audited: three tool-registry lookups and nine read-only Node REPL calls. [Tool-scope audit](./lifecycle/score-tool-audit.json). |
| Independent grade | Fresh Opus 5 session, 04:01:58–04:55:44 UTC, exit 0, 3,226.682 seconds; `uncalibrated-grader` (`calibrationPassed: false`). One phase rerun followed the grader's own omitted push worker; the original attempt remains recorded. |
| Host sampling | 143 samples from 02:36:16.772 to 04:59:18.475 UTC, beginning before the builder and continuing past both assessments. Sampler stopped at 04:59:34.605 UTC. One-minute load min/median/max: 7.61/19.87/109.98 on 18 CPUs; sample intervals 60.370–60.516 seconds. [Statistics](./lifecycle/host-load.statistics.json) and [raw samples](./host-load.jsonl). |
| Full packet | M5 `/Users/ccheever/clique-sb4-20260922-astra-cal17/`. |

All 89 regular files from the qualified published SDK, platform and Expo
tarballs match the full pre-grade snapshot manifest: 69 SDK files, three
platform files and 17 Expo files, including the qualified CLI binary.
[Installed-member comparison](./lifecycle/installed-qualified-members.json).
The [builder's setup declaration](./astra/setup-identity.json) is retained
separately and does not claim independent executable qualification.

The launcher verified Node 24.18.0, but builder login shells initially ran
Node 25.9.0. The builder subsequently corrected its own commands to Node 24.
The launcher environment alone does not establish every subprocess identity.

## Interpretation boundary

This is one descriptive run, without causal attribution to individual fixes.
The preceding cal16 result remains frozen at 88/100, 104 pass, zero fail and
15 not run; the earlier 0.2.31 result was 91/100, 100 pass, one fail and 18 not
run. No run is selected or repeated because its score is less favorable.
The external builder clock was 4,924.230 seconds versus cal16's 4,752.700
seconds, about 2 minutes 52 seconds longer. The different authored app,
correction loops and shared-host conditions prevent attributing that change
or the score change to any one release improvement.

The [separately qualified native application](../../../snapback4/reports/20260922-clique-native-extension.md#final-public-package-result) is the preserved cal16 extension,
installed with the final public packages. Its three scenario passes do not
fill this cold run's missing native assertions or change either frozen score.
Physical devices, Android, power loss and real-provider delivery are outside
that native evidence. The busy-chat digest runtime limit remains unresolved.

## Builder attempts and metrology

Preserve the original artifacts and chronology, including the following:

- The first full replay failed at action 47,075 because the app's `OWN_POST`
  rule prohibited own reposts. The builder attributed this to its schema.
- The second replay passed, but used an in-memory backend. The builder
  recognized that it was not the persistent final deliverable.
- A persistent attempt failed on a `complete=false` assertion. The
  builder attributed this to reconstructing a Trending array and dropping
  its merge continuation. Its original failed clock is preserved as
  `scale-resume1-clock.json` in the verified snapshot. That later discovery
  corrects the operator's earlier uncertainty about clock custody.
- An immediate retry failed on its first action with `E_OFFLINE`/server
  unreachable; its actual receipt was preserved.
- The resumed persistent replay ran from epoch 1790134674 to 1790135284,
  reported 167,243 combined starter/scale entries and passed the builder's
  final correctness verification. The
  recorded 610 seconds includes 70.046 seconds of excluded probes; its
  reported replay time is 539.954 seconds. The complete persistent sequence
  began at epoch 1790134391: its 893-second span includes the failed segment
  and correction/restart interval. The final snapshot preserves the stopped
  700,481,536-byte SQLite store; the operator did not open it to manufacture
  another successful audit.
- Its performance summary reports `allMeasuredRelativeRulesPass=false`.
  Search p95 was 3.524791 / 3.470875 / 2.609416 ms at 10/50/100 percent.
  The midpoint exceeds the interpolation limit of 3.117958 ms. Preserve the
  failed relative rule even though the full-scale value is lower. The builder
  calls timing noise versus method ambiguous; the operator establishes no
  cause.
- A later typing recheck exceeded five seconds on three observations. The
  builder attributed this to unthrottled per-keystroke writes and changed its
  coalescing/TTL. Independent grade results must remain separate from that
  self-verification and attribution.

Shared-host contention was substantial. A passive observation at
03:36:29 UTC recorded load 75.90/65.83/44.25 on the 18-CPU host and substantial
processes from another checkout. No unowned process was stopped. Neither the
load sample nor the presence of other processes establishes the cause of an
app error or failed timing assertion. The installed browser's plist version
is not proof of the browser identity used by the benchmark.

## Holistic result

The [actual scorer output](./astra/FINAL.md) gives **92**, four points above
cal16 and one above the preceding 0.2.31 run. It credits built-in offline
writes, authorization, asset lifetime and scheduled work. Data modeling
remains its lowest category at 86: Quarry's language, nullability,
completeness, index and bounded-operation rules still demand learning.
The scorer treats the missed search midpoint rule as an observed limit;
it does not infer a platform performance defect from it.

The scorer read the frozen brief, four delivered permitted narratives and
four source files. Its attempted read of `run-record.json` found that file
missing. It read no earlier score, grading output, other lane or Snapback
repository, and performed no mutation or runtime test. The holistic score
measures reported builder experience; it is separate from functional grading.

| Category | 0.2.31 | 0.2.32 | 0.2.33 |
| --- | ---: | ---: | ---: |
| setup_and_docs | 93 | 91 | 94 |
| data_modeling | 85 | 82 | 86 |
| authorization | 97 | 95 | 95 |
| queries_and_live | 89 | 86 | 89 |
| writes_and_transactions | 95 | 93 | 94 |
| offline_sync | 95 | 90 | 96 |
| media_assets | 98 | 96 | 97 |
| background_work | 90 | 84 | 94 |
| client_integration | 90 | 85 | 90 |
| diagnostics_dev_loop | 94 | 91 | 94 |
| scale_and_limits | 86 | 88 | 92 |
| operations | 87 | 85 | 88 |
| overall | 91 | 88 | 92 |

## Preserved application and evidence limits

Before grading, the operator verified that all recorded builder/server/worker
PIDs had stopped and ports 49360–49379 had no listener; no operator termination
was needed. A full APFS copy ran from 04:00:49.819 to 04:00:56.659 UTC, then
source-before, source-after and snapshot matched across 44,236 entries,
38,038 regular files and 3,488,349,291 logical file bytes. There were no
exclusions. [Custody receipt](./lifecycle/builder-custody.json).

The full immutable app is `attempts/builder-completed/` on M5. Its complete
file/mode/symlink manifests remain adjacent to it. This repository retains
selected receipts plus the authored-source and narrative manifests; it does
not pretend to contain the full app/store/dependency archive. Root verified
all 31 selected builder evidence files and five delivered narratives against
the full snapshot manifest before copying them here.

The [builder report](./astra/lane-final-report.md), [diary](./astra/lane-diary.md),
[essay](./astra/lane-essay.md), [run log](./astra/lane-run-log.md) and closing
message are verbatim. Their relative links refer to the full packet. The
builder reports zero proven platform defects and records its app corrections
and environment issues; that attribution is distinct from independent grading.

Two evidence omissions remain explicit. `run-record.json` was not delivered.
The original M2 first-green suite payload was overwritten and could not be
recovered; the builder says final M2 green binds a retained matching suite.
Other historical suite payloads were recovered to their recorded hashes;
[its archive index](./astra/evidence/suite-archive/index.json) identifies those
artifacts. The operator did not recreate missing narratives or receipts.

The builder removed 46 performance-probe posts through an exact-ID Quarry
maintenance job, keeping its SQLite backup, target IDs and job record in the
full packet. The [final restored audit](./astra/evidence/scale-restored-final-full-audit.json)
reports the required entity counts. The stopped store was retained in the
full snapshot. Those delivery steps and corrections count in builder wall time.

## Independent functional result

The [primary report](./astra/grader-report.json),
[M8 companion](./astra/m8-assertion-results.json) and
[trace](./astra/trace.md) account for all 119 frozen IDs, with no duplicate,
missing or extra ID and no invalid status. The primary report has 101 IDs
(85 pass, 16 not-run); M8 contributes 18 (16 pass, two not-run).
[Independent operator count and comparison](./lifecycle/grade-comparison.json).

| Milestone | Pass | Fail | Not run |
| --- | ---: | ---: | ---: |
| M1 | 13 | 0 | 0 |
| M2 | 27 | 0 | 0 |
| M3 | 15 | 0 | 0 |
| M4 | 12 | 0 | 0 |
| M5 | 12 | 0 | 0 |
| M6 | 6 | 0 | 7 |
| M7 | 0 | 0 | 9 |
| M8 | 16 | 0 | 2 |

Only `m6-a05`–`m6-a07` differ from cal16: pass becomes not-run because
this grader requires the specified native recordings/receipts. Cal16's
grader credited browser choreography for those three checks. This difference
adds no functional failure and is not new native coverage. Against 0.2.31,
only typing expiry (`m3-a07`) changes, from fail to pass. All prior reports
and labels remain frozen.

The grader reports no blocker or major defect, two minor defects and one
cosmetic defect. Its minor findings concern typing-expiry margin and mutable
suite-receipt aliases, including the unrecovered original M2 artifact. The
cosmetic finding is 50 ordinal-zero messages left in the development store
by live schema adoption; it reports all 100,015 retained-scale messages have
nonzero ordinals and the app handles the development residue.

The typing finding retains historical failures. Those three missed checks
preceded the builder's logged coalescing/TTL correction; the independent
checks on the final app passed at 2,878 / 3,374 / 3,362 ms. This record preserves
the grader's minor classification and timing evidence without presenting the
pre-correction miss as a reproduced failure of unchanged final code or
independently assigning its cause to machine load.

Objective dimensions are O1 78, O2 82, O3 null, O4 60 and O5 band **30**.
O3 lacks the required secret holdout inputs; it is not an applicability null,
and no weighted total is valid. O4 credits the recorded browser behavior but
retains the absent native evidence. O5 applies the strict search midpoint
predicate described above; lower full-scale latency does not override the
failed rule. These dimensions are distinct from the 92-point holistic score.
The grader's calibration flag remains false.

## Final custody and aggregation

The complete grading directory was copied and verified at
`attempts/grade-completed/` on M5 (62 entries), and the separate temporary
grader outputs were retained under `attempts/grader-external-outputs/`.
The final comparison finds no application-code change. Acceptance reruns
changed suite-status receipt paths and appended two start/stop lines to the
original lane's run log at 04:06:29/30 UTC; data, suite receipts and logs also
changed as disclosed in the [post-assessment record](./lifecycle/post-assessment-changes.json).
The pre-grade app and narratives remain intact. The retained scale database
file is unchanged, while its SQLite WAL/SHM bytes changed during access; this
is not a byte-unchanged claim for the complete live database directory.

The scorer had exited at 04:04:42 UTC, before those run-log appends. Root also
compared the actual returned run-log text from its tool call with the
pre-grade bytes: they match exactly. [Score input custody](./lifecycle/score-input-custody.json).
The other delivered narratives and application code remain unchanged. Thus
the grader's side effects do not substitute a later narrative for the scorer's
recorded input.

Each unchanged three-lane aggregator ran exactly once and exited 1 on its
first missing Grok lifecycle record. Both Grok and Muse builder lanes are
unrun; no all-lane aggregate is claimed. The [commands and outcomes](./lifecycle/aggregator-operator.json),
[grade error](./lifecycle/summarize_grades.py.operator.log) and
[score error](./lifecycle/aggregate_scores.py.operator.log) are retained. The
Astra-only tallies above are labelled operator summaries, not outputs from
patched aggregation tools. All benchmark-owned listeners and processes were
stopped, and the sampler ended after the model phases and final custody.
The frozen instrument, templates and scripts remain unchanged.

The final independent [Astra max record audit](./lifecycle/record-review-final-astra.md)
returned READY with no material findings. It binds the results, preserved
receipts and selected-program closeout; it does not broaden runtime coverage.
