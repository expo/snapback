# Snapback 2 0.0.25 publication and Clique on builder-1000

Status: snapback2@0.0.25 and its Linux x64 and Darwin arm64 packages published successfully at 2026-09-11T21:40:41Z. All three registry hashes and latest tags match the qualified artifacts. The cold builder completed at `/home/ccheever/clique-0025-20260911`, ports 53200–53219; independent grading, fresh M7, and absolute-rubric scoring are complete. The experience score is **85/100**.

The user requested a new Snapback 2 publication followed by Clique on builder-1000. Version 0.0.24 was already published, but predates main's incremental acquisition change (`b585f410d`); this run publishes 0.0.25 from `d3add997c1b4`, including main `99a2551f5`. The release version commit is on origin/main.

The warm Linux release lane is `/home/ccheever/lanes/clique-20260909-footprint-baseline` on `100.65.137.99` (expo-build-1000; observed hostname expose-builder-pixel). The warm Mac release lane is `/Users/ccheever/projects/snapback` on Silver `100.76.94.78`. Their product inputs match; Silver additionally retains the preceding publication's metric. Existing prepared Hermes inputs are reused without rebuilding or changing Hermes.

The publisher self-test passed. Host-only Linux and Mac stages each passed all 19 production consumer checks, including effects and both templates. The Linux unified stage also passed all 19 checks. Final Mac qualification of the identical unified shim passed all 19 checks. The final publication invocation repeated the Mac consumer proof successfully before publishing all three tarballs. Initial build attempts exposed absent SSH PATH/toolchain defaults; logs retain those failed attempts and the explicit prepared-toolchain retries.

Clique copies only the generic wrappers and frozen 170-file instrument from `/home/ccheever/clique-ri-20260911` at `f40559f37722c79178be664a11f8a6485f1508fd`. A fresh Astra medium builder runs M1–M6/M8; a fresh Opus grader runs before fresh Astra M7, followed by absolute-rubric scoring. No previous implementation or findings are supplied to the builder.

This is one Linux calibration/diagnostic run. Apple simulator proof is unavailable. Raw native Codex usage is retained but authentic milestone-boundary joins and cap adjudication are unavailable in the prepared lightweight runner. No holdout probes were committed. The preparation's intermittent choreography self-test observations remain disclosed in its PREPARATION.md; frozen thresholds are unchanged.

## Concurrent-run discovery

At launch, the original preparation was no longer unstarted: a separate supervisor had launched a 0.0.24 builder at 21:36:51 UTC on ports 53100–53119. Our final preflight correctly refused occupied port 53100, before any 0.0.25 actor was started. Our earlier version-file update had changed that preparation to 0.0.25; it was restored to 0.0.24 immediately on discovery. The refused preflight also truncated its shared pre-builder.json through tee; that lost preflight is not reconstructed or represented as retained. No existing builder, product file, prompt, or server was stopped or changed.

The new 0.0.25 run has its own directory and ports. Only frozen instrument files, generic wrappers/templates, and the schema helper were copied, with a shared Playwright dependency installation. No previous app, findings, diary, score, or transcript was copied. The concurrent 0.0.24 load is disclosed, so this is a functional N=1 diagnostic run, not a controlled comparative wall-time result.

## Builder outcome

The Astra medium builder exited 0 after 9,990 seconds. It records M1–M6 and M8
as suite/choreography green, with 9,367 seconds to its final authoring boundary.
These were builder claims; the independent adjudication follows below. Its full replay
settled 167,157 actions and passed 10/50/100% invariant checks, including
100,015 messages and 50,228 posts. Replay gross time was 2,594 seconds, including
an unsuccessful first attempt caused by an app-authored membership cap; the
retry retained the original clock. See the retained builder final report and
scale-clock receipt under `benchmark/lanes/astra-snapback2/`.

The builder's first discarded M1 browser attempt inherited an endpoint pointing
to port 53100 and sent signup/profile traffic to the concurrent lane. The builder
corrected the endpoint itself. This is an actual isolation breach, beyond shared
machine load; the run is not a clean comparative calibration. M3 uses a disclosed
trio adapter because the frozen receipt fixture expects Erin without launching
an Erin client. Both limitations remain part of the result.

A pre-M7 source/report archive is retained remotely at
`snapshots/astra-snapback2-pre-m7-source.tgz` with SHA-256
`84d6e953f4b4b02642c1353463bac1586ec03c7dd638d754f4016bac34c8db59`.
Raw native builder rollouts remain under `native/codex/astra-snapback2-builder/`
on the same host, with the launcher's manifest. They are retained but not joined
to authentic milestone boundaries; no token-cap adjudication is claimed.

The observed long-job CLI wait diagnostic has a [follow-up ticket](../../../issues/20260911-snapback2-job-wait-reports-owner-stopped-under-load.md).

## Independent pre-M7 grade

Fresh Claude Opus 5 completed grading with exit 0 in 3,093 seconds. Its report
passes AJV draft-2020-12 validation. The grader records itself uncalibrated,
from a different family, and uncontaminated. No holdout probes were committed.

The [grader report](benchmark/lanes/astra-snapback2/grading/grader-report.json)
and [sanitized trace](benchmark/lanes/astra-snapback2/grading/trace.md) report
101 passing, 18 not-run and zero failed assertions out of 119. The not-run
assertions are nine M7 assertions and nine Apple-simulator assertions. This grade
binds the pre-M7 artifact; later M7 completion must not silently revise it.

| Dimension | Pre-M7 grade |
|---|---:|
| O1 functional completeness | 80 |
| O2 correctness | 82 |
| O3 trust boundaries | Not applicable |
| O4 observed offline behavior | 65 |
| O5 scale | Band 75 |

No weighted total is inferred. The grader reports no blocker or major defect,
five minor defects and one cosmetic issue: weak Trending test discrimination,
raw or missing search-refusal feedback, an order-fragile push-test precondition,
an intermittent attachment-semantic race, and no follow-list enumeration API.
These are benchmark-app/test findings; they are not all framework defects.

The grader independently confirmed session revocation, edit-window enforcement,
media custody after deletion/view-once, expiry purge, and exactly-once digests
across a process restart. It rechecked the scale manifest and measured full-corpus
read ratios of 1.01x (deep paging), 1.05x (500-follow feed), and 0.99x
(celebrity-follower feed), below the 3x bound. Unset absolute ceiling/cap
placeholders and missing checkpoint probes prevent stronger scale claims.

## Fresh M7 evolution

A fresh Astra medium session completed M7 with exit 0 in 1,060 seconds
(1,034 seconds in its reported authoring clock). Its
[report](benchmark/lanes/astra-snapback2/m7/final-report.md) records green
poll creation, changeable/idempotent votes, offline vote settlement,
conversation message-count backfill and forward maintenance. All seven prior
milestone suites passed, and M7 choreography passed after correcting an
app-authored pending-state bug.

The optional-field successor, backfill, then required-field successor preserved
exact normalized snapshots for eight personas, two conversations and 15 unique
messages. This starter-state snapshot had zero populated media references and
zero messages with reactions, so preservation of those fields was vacuous;
prior media/reaction suites did pass. Scheduled text and poll expiry also removed
both count contributions. M7 is builder-verified, not independently regraded;
the pre-M7 Opus grade is retained unchanged. No native execution is claimed.

Post-M7 source archive SHA-256:
`76539cdc85e3e954481b839d238dc5eebc8f04fde70fee22147411f9071992e3`,
remote `snapshots/astra-snapback2-post-m7-source.tgz`.

## Scoring environment retry

The first fresh scorer could not initialize its read-only sandbox:
`bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`. It read no
lane evidence and returned null scores. That attempt remains under
`scores/astra-attempt1-sandbox-unavailable/` on the run host. A fresh retry uses
the unchanged absolute rubric with the complete brief and narratives supplied
verbatim in the prompt, including the completed M7 narratives, and explicitly
requires no tool calls. This environment failure is not charged to the backend.

## Final experience score

The fresh Astra xhigh scorer completed the inline-evidence retry with exit 0 in
153 seconds. Its [scoring output](benchmark/scores/astra/FINAL.md) assigns
**85/100 overall**. This is a holistic backend-experience judgment from authoring
narratives, not an independent correctness grade or a weighted O-dimension total.
The scorer was prohibited from reading the Opus grading directory.

| Category | Score |
|---|---:|
| Setup and docs | 84 |
| Data modeling | 82 |
| Authorization | 91 |
| Queries and live updates | 76 |
| Writes and transactions | 92 |
| Offline sync | 89 |
| Media assets | 93 |
| Background work | 82 |
| Client integration | 80 |
| Diagnostics and development loop | 84 |
| Scale and limits | 78 |
| Operations | 87 |

All requested phases completed. Full raw process logs, databases, native rollout
trees and unabridged evidence remain on builder-1000 at the run root. The
repository retains selected reports/receipts and source snapshots; report links
to other evidence resolve in the original remote lane. Server cleanup and the
subsequent clear-port preflight are retained. No native-simulator, controlled
comparative timing, calibrated-grader, holdout, or authentic token-cap claim is
made. The initial cross-port traffic remains an explicit run-integrity limitation.
