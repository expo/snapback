# Astra-medium Clique calibration #16 — `snapback4@0.2.32` / `snapback4-expo@0.2.23`

**Holistic score: 88/100. Independent grade: 104 passed, zero failed,
15 not run.** The continuous cold builder completed successfully at
20:31:50 UTC on 2026-09-22; independent grading finished at 21:14:10 UTC.
The missing assertions cover M7 and six native observations. The separate
actual-app native extension is still in progress.

This run follows the author's instruction to review and implement the selected
[LLP 3000.011](../../../llp/3000.011-recent-builder-friction.research.md)
proposals, publish, then rerun Clique. The independent design and implementation
reviews used Grok 4.7 xhigh and Astra max; implementation used Astra xhigh.
The comparable benchmark retains its established Astra **medium** builder,
Opus 5 independent grader and Astra xhigh holistic scorer.

## Packet and scope

| Item | Record |
| --- | --- |
| Packages | Published `snapback4@0.2.32`, `snapback4-darwin-arm64@0.2.32` and `snapback4-expo@0.2.23`; all three registry integrities matched the qualified tarballs before launch. |
| Package source | `c482a089d0cb26929066545742c97ac8c21a2db2`; publication and installed-consumer evidence is in the [application report](../../../snapback4/reports/20260922-application-evidence.md#publication-and-installed-package-result). |
| Instrument | The same 179 files from `30fea66c9b20dbea50e6d8444a61c2cd9ca3c787`; manifest SHA-256 `89b8c59d734334c015eaed025a52488e4c6266aabd40e21ade6a75ffd35381d2`. |
| Prompt templates | Unchanged; manifest SHA-256 `33e54d45d451400c38d9e1f738ebcd0181b0fc6c8fbf97de60e4fc15033b0f2e`. |
| Measured lane | One fresh Astra lane, continuous M1–M6 and M8; M7 and the Grok/Muse builder lanes remain unrun. No prior app, source checkout, private review finding or implementation hint is supplied to the builder. |
| Builder lifecycle | 19:12:37–20:31:50 UTC, exit 0, 4,752.700 seconds by the external runner. The builder's internal clock is separately retained in its report. |
| Builder usage | The external Codex completion event records 34,698,491 input tokens, including 34,110,464 cached input tokens, and 119,029 output tokens. The builder itself had no access to this record and left its own usage fields null. [Raw usage event and log digest](./lifecycle/builder-usage.json). |
| Independent grade | Fresh `claude-opus-5` session, 20:33:33–21:14:10 UTC, exit 0, 2,436.317 s; `uncalibrated-grader` (`calibrationPassed: false`). The grader explicitly excludes the builder's diary, essay, final report and run log from its inputs. |
| Holistic score | `gpt-6-astra`, xhigh, 21:04:38–21:06:43 UTC, exit 0, 125.179 s. This read-only step overlapped the grade, as the unchanged runner permits; it read only the frozen brief, five permitted narratives and four lane source files. [Tool-scope audit](./lifecycle/score-tool-audit.json). The grader retained the only heavy execution slot. |
| Host | Shared M5 Max, 18 CPUs, macOS; benchmark ports 49360–49379 were free at launch. The [load stream](./host-load.jsonl) has 111 samples from 19:25:11 to 21:14:58 UTC: one-minute load min/median/max 7.03/9.07/24.51. Start load is separately retained in `RUN_QUALIFICATION.json`; the initial sampling gap is not reconstructed. The sampler resumed at 21:07:58 after stopping at score completion; both lifecycle records and actual timestamps are retained. |
| Retained full packet | M5: `/Users/ccheever/clique-sb4-20260922-astra-cal16/`. |

The separate actual-app native/acquisition extension starts only after the cold
build and independent grading have finished. It uses a preserved copy of that
application and the published packages, without altering the frozen instrument
or retrospectively changing its score. A Hermes export alone does not count as
an installed native witness.

The launcher verified Node 24.18.0 and prepended it to the process environment.
The builder discovered that its login shells replaced that PATH with Node 25;
it changed subsequent commands to non-login shells during M5. This environment
deviation and the preceding attempts remain in its log. The operator supplied
no corrective hint. A stale Metro-generated API also required a cache restart;
the builder's attribution remains `ambiguous`.

## Interpretation boundary

This is one descriptive post-release run. It does not isolate any one of the
release's diagnostics, feed bridges, web starter, CLI retry or guide changes.
The busy-chat digest heap boundary remains; the proposed runtime optimization
was rejected after measurement. The previous [0.2.31 run](../2026-09-20-snapback4-clique-astra-0.2.31/README.md)
scored 91 with 100 pass, one fail and 18 not-run assertions. Compare actual
scenarios and defect evidence as well as scores; grading labels have varied
between earlier runs.

## Results

The [independent report](./astra/grader-report.json),
[M8 companion](./astra/m8-assertion-results.json) and
[execution trace](./astra/trace.md) record **104 pass / 0 fail / 15 not-run**
across the 119 frozen assertions. The primary report contains 101 assertion
IDs and the companion contains the remaining 18 M8 IDs. The prior 0.2.31
record also has an M8 companion; this layout is not new evidence by itself.

| Milestone | Pass | Fail | Not run |
| --- | ---: | ---: | ---: |
| M1 | 13 | 0 | 0 |
| M2 | 27 | 0 | 0 |
| M3 | 15 | 0 | 0 |
| M4 | 12 | 0 | 0 |
| M5 | 12 | 0 | 0 |
| M6 | 9 | 0 | 4 |
| M7 | 0 | 0 | 9 |
| M8 | 16 | 0 | 2 |

Four assertion statuses differ from 0.2.31. Typing expiry (`m3-a07`) changes
from fail to pass, with measured expiry after the last keystroke of
4,324.3 / 4,830.2 / 4,314.5 ms against the unchanged 5,000 ms limit.
Three M6 assertions (`m6-a05`–`m6-a07`) change from not-run to pass because
this grader credited the browser choreography for pending messages, ordered
flush and read receipts. The prior grader left them unrun alongside the
missing native artifacts. Those three label changes are not new native
coverage or isolated evidence of platform improvement.

The grader found no blocker or major defect, one minor defect and three
cosmetic defects. The minor defect is acceptance-test repeatability: later
milestones push the starter quoted message off the newest-50 history page,
so the M3 suite no longer reruns green from the delivered state. Independent
browser checks on a fresh conversation verified the actual quote excerpt
and jump behavior. The cosmetic findings are duplicated fixture credentials
in lane scripts, an unaddressed completeness note on the diagnostic digest
preview, and an undocumented distinction between a DM-pair row ID and its
conversation ID. The scheduled digest path and required API-only variation
passed. These are grader findings about this built app, with their exact
evidence and severity retained in the report.

The separate objective dimensions are O1 78, O2 85, O3 unscored (no holdout),
O4 20 (native evidence absent), and O5 band 75. The frozen instrument has no
calibrated absolute p95 ceiling table, so the grader cannot award the
ceiling-dependent O5 band 90. These dimensions are distinct from the holistic
experience score below.

The [actual scorer output](./astra/FINAL.md) gives **88**, three points below
the prior run's 91. The prior thirteen comparable holistic scores ranged
from 85 to 91. This single post-release run does not isolate the effect of
any one change. The scorer cites Quarry/feed complexity, bounded digest
work, native evidence still absent from the comparable task, and the newly
reproduced type-generation defect. Native extension results will not change
this frozen score.

| Category | 0.2.31 | 0.2.32 | Change |
| --- | ---: | ---: | ---: |
| setup_and_docs | 93 | 91 | -2 |
| data_modeling | 85 | 82 | -3 |
| authorization | 97 | 95 | -2 |
| queries_and_live | 89 | 86 | -3 |
| writes_and_transactions | 95 | 93 | -2 |
| offline_sync | 95 | 90 | -5 |
| media_assets | 98 | 96 | -2 |
| background_work | 90 | 84 | -6 |
| client_integration | 90 | 85 | -5 |
| diagnostics_dev_loop | 94 | 91 | -3 |
| scale_and_limits | 86 | 88 | +2 |
| operations | 87 | 85 | -2 |
| overall | 91 | 88 | -3 |

The [builder report](./astra/lane-final-report.md),
[diary](./astra/lane-diary.md), [essay](./astra/lane-essay.md) and
[correction log](./astra/lane-run-log.md) are retained verbatim. Relative
links within those original artifacts refer to the complete packet on M5;
selected receipts are also retained under `astra/evidence/` here.

| Builder observation | Result and boundary |
| --- | --- |
| Required authoring milestones | M1–M6 and M8 green; seven Hermes exports. M7 remains unrun; exports do not qualify installed native behavior. |
| First full replay | All three invariant checkpoints passed; 167,243 reported settled entries including starter replay. 687.494 s replay, 188.754 s excluded verification/probes, 876.248 s wall. [Receipt](./astra/evidence/scale-result.json). |
| Final M8 schema replay | All three invariant checkpoints passed; 167,243 reported settled entries. 703.442 s replay, 197.256 s excluded verification/probes, 900.698 s wall. [Receipt](./astra/evidence/m8-scale-result.json). |
| Degradation probes | All eleven recorded checks passed, including deep history, Following, search, insights, trending, celebrity writes and cold sync. [Measurements](./astra/evidence/degradation-checks.json). |
| Separate headless cold-device probe | Acquired a 100-conversation inbox in 4,490.446 ms. Maximum sampled combined Node/interpreter RSS was 397,099,008 bytes over 44 samples, approximately 100 ms apart. This is neither an exact memory peak nor a native Release measurement. [Receipt](./astra/evidence/cold-scale-proof.json). |
| Offline lifecycle | Browser process-restart proof passed; earlier M6/M8 choreography timeouts remain recorded as ambiguous. Later passes followed acquisition gating and cached DM routing changes without establishing the cause of every earlier timeout. [Restart receipt](./astra/evidence/offline-restart-proof.json). |
| Digest | The small scheduled fixture passed with all clients closed, restart and an empty next period. The builder explicitly retains the one-recipient transaction's meter boundary; this does not establish full-scale busy-chat digest qualification. [Receipt](./astra/evidence/digest-proof.json). |

The builder reproduced a nullable-object-array TypeScript emission defect.
The [follow-up ticket](../../../issues/20260922-snapback4-generated-nullable-row-array-precedence.md)
records its small reproduction and the matching, unchanged emitter source.
The application uses a workaround; the published package was not edited.

Before grading, all assigned listeners were verified stopped and a complete
APFS copy of the lane was preserved at `attempts/builder-completed/`. The
instrument and prompt-template hashes were unchanged. The
[custody record](./lifecycle/builder-custody.json) identifies that snapshot
and its selected source/metadata manifest. The actual-app native extension
remains separate and pending. The unmodified three-lane grade and score
aggregators each exit 1 because the Grok and Muse lifecycles are absent,
as in the prior single-lane run; the completed Astra outputs and aggregation
messages are retained without editing the frozen tools.

The [Astra max record audit](./lifecycle/record-review-astra.md) found no
material discrepancy between this operator summary and the retained evidence.
Its optional grader-calibration clarification is incorporated above. This
post-run evidence audit is not another benchmark grade or rescore.
