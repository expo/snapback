# Read-only analysis of the 2026-09-11 follow-up timing reds

Recorded by Astra on 2026-09-11. No builds, tests, product launches, or new measurements were run for this analysis. Source and saved evidence were read; existing numbers and file hashes were compared; a later host process snapshot was inspected. This file is an ignored diagnostic, not a performance qualification or budget change.

The investigated result remains **consumer 66.62 s against 30 s** and **project check 1.524 s against 1 s**. Both direct doctor samples pass at 0.267/0.066 s. There is no signing repair and no evidence that these two new timing failures have been repaired. The saved data make a single slow initial CLI launch an insufficient explanation. Broad host/setup effects are plausible, but contemporaneous evidence is missing and a product contribution remains unresolved.

Before this report was finalized, root supplied a second completed canonical run, starting `2026-09-11T18:42:07.888Z`, retained in `/tmp/snapback2-followup-final-measure.log` and the same metrics file. It also fails: **consumer 37.60 s; project check 1.163 s**. Doctor passes at 0.218/0.057 s; functional stages succeed under the same receipt rules. Chat check is 2.711 s, chat bundle 2.868 s, and chat test 12.275 s; package build remains 8.040 s. Final-source bytes are client 139450, React 149260, Expo 152792, runtime 88086, all still above the accepted byte baseline. This second red demonstrates varying observations, not a controlled causal result: source inputs and host conditions were not held fixed between the runs.

Evidence is `snapback2/metrics/loop.jsonl`, `/tmp/snapback2-followup-measure.log`, `snapback2/scripts/consumer-smoke.mjs`, `snapback2/scripts/measure.mjs`, and the retained `bytes-*` snapshots in this directory. The compared records start at `2026-09-11T15:38:58.398Z` (HEAD field `bf8450849`) and `2026-09-11T18:28:43.771Z` (HEAD field `b3b063b4e`). The former is the earlier four-plan run referred to in discussion. These fields record HEAD, not a dirty-tree digest or executable identity; they must not be presented as exact clean-source qualifications. `at` is assigned at the start of the measurement, not at its completion.

All named commands succeeded under the harness's existing acceptance rules. `steps.*.ok: true` means command success, not satisfaction of a time budget. Both chat receipts accept the same development-only engine-absence blocks, `a sent message notifies the recipient, effects`; there is no new accepted block explaining the duration difference.

| Existing observation | Earlier seconds | Current seconds | Added seconds |
| --- | ---: | ---: | ---: |
| Complete consumer smoke | 13.350 | 66.620 | 53.270 |
| Install tarballs | 1.028 | 4.264 | 3.235 |
| Installed consumer doctor | 0.326 | 0.851 | 0.525 |
| Todos init | 0.385 | 2.034 | 1.650 |
| Todos check | 0.370 | 2.414 | 2.044 |
| Todos React bundle | 1.749 | 4.475 | 2.726 |
| Todos test | 0.616 | 1.815 | 1.199 |
| Chat init | 0.536 | 7.128 | 6.591 |
| Chat check | 0.538 | 9.478 | 8.940 |
| Chat React bundle | 0.767 | 7.213 | 6.446 |
| Chat dev | 0.596 | 3.723 | 3.127 |
| Chat test | 4.425 | 18.709 | 14.283 |
| Separate direct project check | 0.461 | 1.524 | 1.063 |
| Package build | 1.746 | 7.378 | 5.632 |
| Native incremental build | 2.340 | 8.260 | 5.920 |

Rounded columns can differ by 0.001 s from rounded deltas. Chat init/check/bundle/dev/test account for approximately 39.39 s of the 53.27 s increase. Named consumer stages total 12.005/63.462 s; the remaining 1.345/3.158 s includes staging, two package operations, and cleanup around the named stages. Installation alone, that outer overhead, or the 0.525 s installed-doctor increase cannot explain the total.

The warm native build decreased from 67.96 to 9.04 s. Its cache work was different, so that is not a matched speedup control. In contrast, multiple other stages inflated, including the unchanged native incremental build. The saved output contains no child CPU times, per-stage absolute timestamps, process pressure, or successful check output that would explain those changes.

The consumer harness's clocks surround external processes. `consumer-smoke.mjs:94` measures `spawnSync` lifetime, including the acceptance callback; installed commands run the Node shim, which launches the native CLI. Every consumer uses a fresh temporary npm installation. Installation uses `--prefer-offline`, not a guarantee of zero registry/network work. Successful temporary consumers are deleted. The exact measured installation and its inode cannot now be inspected.

The installed doctor uses a fresh copied executable; the separate doctor samples use `target/release/snapback2`. Passing the latter does not establish the former's first-launch cost. However, chat check runs after installed doctor, guide, exports, and the todos lifecycle, reusing the same installed CLI. A single first launch of that CLI does not explain the later 9.478 s check or all later stages. First launches of other helpers, import/setup work, filesystem work, and resource contention remain possible; no saved OS log attributes them.

The direct project check is also a distinct path: `measure.mjs:285` checks `packages/compiler/fixtures/quarry-chat` through the release CLI and built compiler, while consumer check uses a generated installed template. Their absolute durations should not be treated as repeated samples of the same command. Their common slowdown is supporting context, not a controlled comparison.

Static inspection found no difference since the four-plan landing `75a67c92c` in `snapback2/crates`, `snapback2/scripts`, `snapback2/packages/compiler`, or the package templates. The ESM experiment changes the public/client/test entry closures; the compiler build entries do not use that externalization plugin. In the retained `bytes-current` and `bytes-experiment-primitives` snapshots, both compiler outputs are byte-identical:

- `compiler.mjs`: `9c93d2adc425eab14d977a2a8b0d1228a0a5c8c27c4e59bc889efe9863490a78`
- `compiler-core.mjs`: `ae432f5c70744110b305409aa2a60e9576f0d8c3abced2387ef58e1f555be82e`

Those snapshots isolate ESM deduplication, with changed client, image-runtime, and test-runner outputs. They do not isolate the entire current send/ack work, and they are not a reconstruction of the exact dirty tree that produced the timed record. Compiler equality rules out changed compiler output in that isolated comparison; it does not prove the full consumer cannot regress through another path.

A read-only host snapshot at `2026-09-11T18:37:18.886695Z` found the coordinator MacBook Air (M5, 10 logical CPUs, 32 GiB) at load averages 11.94/10.54/10.15, with `memory_pressure -Q` reporting 39% system free. Active processes included rustc at 66.8%, esbuild at 47.8%, WindowServer at 73.2%, and several Chrome processes. Approximately 263 GiB remained available on disk. This observation was after the measured run. It supports reserving an idle lane for a control, but does not prove that these jobs or CPU rates overlapped the failure. No unrelated jobs were stopped and no credentials were inspected.

The immediate recommendation, narrowed with root, is **one four-invocation project-check control**, not another complete build/measurement loop:

1. Reserve one idle Mac lane, keep the existing `snapback2/target/release/snapback2` executable at its original inode, and use the unchanged `snapback2/packages/compiler/fixtures/quarry-chat` fixture. No build, relink, install, template initialization, or prewarm is needed. Record native/compiler hashes, Node executable/version, fixture digest, OS version, and host pressure without dumping the environment. Label this native executable as already launched; it is not a fresh-launch control.
2. Set arm A's package dist to `runs/followup-diagnostics-20260911/bytes-current/snapback2/packages/snapback2/dist`. Set arm B's dist to the final built `snapback2/packages/snapback2/dist`, frozen for the duration. First compare both compiler leaves' hashes. If they match, document that this is an identical-compiler negative control in the baseline and candidate packaging contexts, not an ESM performance comparison. The retained ESM-only alternative, if the final artifact is unavailable, is `bytes-experiment-primitives/snapback2/packages/snapback2/dist`; its compiler hashes are already known to match A.
3. Run exactly A, B, B, A sequentially, always with cwd `snapback2` and command arguments `check --project <absolute quarry-chat fixture>`. For each arm reproduce `measure.mjs:235`'s environment mapping: `SNAPBACK2_COMPILER=<arm dist>/compiler.mjs`, `SNAPBACK2_GUIDE=<arm dist>/guide`, `SNAPBACK2_TEMPLATES=<arm dist>/templates`, and `SNAPBACK2_TEST_RUNNER=<arm dist>/test-runner.mjs`; keep all other non-secret environment inputs fixed. Use the same release binary for all four commands. Do not vary native identity between arms merely because a copied binary is available.
4. Retain every result, absolute start/end timestamp, wall time, child user/system CPU time, exit status, stdout/stderr, and before/after host pressure. A 30 s per-command timeout is consistent with the consumer harness. Existing `/usr/bin/time -p` or a small ignored wrapper can capture CPU and wall separately without executing profiling builds. Stop after those four invocations; failures or inconclusive differences are retained, not retried away.

This control directly probes the separate project-check red and order variability. It cannot establish the cost of the changed public ESM closure, the aggregate consumer, or a fresh signed launch. Broad slowdowns in both arms would be consistent with host/setup effects; fast checks would show that this retained path can meet budget under the control conditions, not that the earlier failures were invalid. An arm-specific difference needs attribution even with identical compiler bytes, since path-dependent imports/filesystem/cache work can differ. Do not call any of those outcomes a consumer repair.

If further work is later authorized, the next discriminating consumer experiment is a pair of retained built-package installations with identical native bytes, dependencies, clean environment, and install flags. Preserve each installed first doctor and take two adjacent chat checks on the same installed inode. Only extend to the existing chat Vite/test stages if the check control leaves their cost unresolved. Retain successful output and CPU times, which the current aggregate receipt omits. Execution-policy attribution additionally requires narrowly scoped contemporaneous Gatekeeper/XProtect logs: low CPU with high elapsed time alone is not enough. Do not preassess binaries, purge caches, change security settings, or seek another signing identity.

A repeated candidate-only increase under matched conditions would justify profiling the changed SDK/import/test path. A cold-only delay needs the retained first sample and execution-policy logs before attributing it to macOS. Broad slowdowns in both arms, especially in identical compiler controls, would support a host/setup explanation; current post-run process pressure alone does not do so. If the diagnostic is inconclusive, report that rather than retrying until a pass appears.

A focused diagnostic cannot clear the 30 s aggregate budget. After any justified fix or explanation, the ordinary complete timing qualification remains necessary on the chosen candidate, preserving its actual first-launch observations. Keep both 66.62/1.524 and 37.60/1.163 records and their failures visible. The four byte-baseline failures and `byte_baseline_accepted: false` are separate findings and remain unchanged by this analysis.

## Executed project-check control

Root ran the bounded A/B/B/A sequence once, after the final build. Both compiler
leaves and the already-launched native executable/inode stayed identical. All
four commands succeeded but exceeded the 1-second budget: A1 **1.560 s**, B1
**2.574 s**, B2 **2.088 s**, A2 **1.260 s**. B is slower in both middle samples;
that difference remains unexplained and cannot be dismissed because compiler
bytes match. Guide/template/test-runner packaging paths differ.

Recorded host load was **16.16–20.71 on 10 CPUs**; this was not an idle-host
qualification. The process snapshots include the concurrently running,
read-only Snapback1 inventory diagnostic as well as unrelated host work. The
four-invocation stop rule was preserved: no retry, cache purge, changed binary
or discarded first observation. This control neither repairs aggregate consumer
timing nor establishes a product/compiler regression or host cause. Exact
inputs, stdout/stderr, wall/child CPU, statuses and pressure observations are in
[project-check-control.json](project-check-control.json).
