# Snapback 2 0.0.25 publication and Clique on builder-1000

Status: snapback2@0.0.25 and its Linux x64 and Darwin arm64 packages published successfully at 2026-09-11T21:40:41Z. All three registry hashes and latest tags match the qualified artifacts. The cold builder completed at `/home/ccheever/clique-0025-20260911`, ports 53200–53219; independent grading is in progress before M7 and final scoring.

The user requested a new Snapback 2 publication followed by Clique on builder-1000. Version 0.0.24 was already published, but predates main's incremental acquisition change (`b585f410d`); this run publishes 0.0.25 from `d3add997c1b4`, including main `99a2551f5`. The release version commit is on origin/main.

The warm Linux release lane is `/home/ccheever/lanes/clique-20260909-footprint-baseline` on `100.65.137.99` (expo-build-1000; observed hostname expose-builder-pixel). The warm Mac release lane is `/Users/ccheever/projects/snapback` on Silver `100.76.94.78`. Their product inputs match; Silver additionally retains the preceding publication's metric. Existing prepared Hermes inputs are reused without rebuilding or changing Hermes.

The publisher self-test passed. Host-only Linux and Mac stages each passed all 19 production consumer checks, including effects and both templates. The Linux unified stage also passed all 19 checks. Final Mac qualification of the identical unified shim passed all 19 checks. The final publication invocation repeated the Mac consumer proof successfully before publishing all three tarballs. Initial build attempts exposed absent SSH PATH/toolchain defaults; logs retain those failed attempts and the explicit prepared-toolchain retries.

Clique copies only the generic wrappers and frozen 170-file instrument from `/home/ccheever/clique-ri-20260911` at `f40559f37722c79178be664a11f8a6485f1508fd`. A fresh Astra medium builder runs M1–M6/M8; a fresh Opus grader runs before fresh Astra M7, followed by absolute-rubric scoring. No previous implementation or findings are supplied to the builder.

This is one Linux calibration/diagnostic run. Apple simulator proof is unavailable. Raw native Codex usage is retained but authentic milestone-boundary joins and cap adjudication are unavailable in the prepared lightweight runner. No holdout probes were committed. The preparation's intermittent choreography self-test observations remain disclosed in its PREPARATION.md; frozen thresholds are unchanged.

## Concurrent-run discovery

At launch, the original preparation was no longer unstarted: a separate supervisor had launched a 0.0.24 builder at 21:36:51 UTC on ports 53100–53119. Our final preflight correctly refused occupied port 53100, before any 0.0.25 actor was started. Our earlier version-file update had changed that preparation to 0.0.25; it was restored to 0.0.24 immediately on discovery. The refused preflight also truncated its shared pre-builder.json through tee; that lost preflight is not reconstructed or represented as retained. No existing builder, product file, prompt, or server was stopped or changed.

The new 0.0.25 run has its own directory and ports. Only frozen instrument files, generic wrappers/templates, and the schema helper were copied, with a shared Playwright dependency installation. No previous app, findings, diary, score, or transcript was copied. The concurrent 0.0.24 load is disclosed, so this is a functional N=1 diagnostic run, not a controlled comparative wall-time result.

## Builder outcome (independent grading pending)

The Astra medium builder exited 0 after 9,990 seconds. It records M1–M6 and M8
as suite/choreography green, with 9,367 seconds to its final authoring boundary.
These are builder claims pending independent adjudication. Its full replay
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
