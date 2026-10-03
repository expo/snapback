# LU — live updates during contended Following backfill

Date: 2026-10-03. Branch: `sb4-intent/lu-live-update-latency`.
Control: `7c9c0c0dabb0528cdee438222bb7eec46e828f16` (origin/main at worktree creation).
Host: eb1000, Linux, AMD EPYC 9454, 48 physical / 96 logical CPUs.

## Finding and change

The commissioned small social fixture exposes a server head-of-line delay:
background delivery repeatedly selects the oldest pending work item until it
finishes. A new two-follower repost can wait behind over a thousand backfill and
cleanup transactions. Most of its commit-to-render interval precedes the
follower-delivery commit. Without backfill, the original implementation already
delivers these small updates well below the requested thresholds.

Background delivery now gives each pending item one bounded slice, then advances
through the existing `byStatusTime` index. It rotates declarations too. Large
backfills and cleanup continue progressing while a new small delivery gets a
turn. Selection uses one existing indexed work row, plus an empty seek at wrap;
there is no new persisted queue or index. Position hints are transient and reset
on open/adoption. Durable cursors, edge epochs, admission tokens and copies still
commit atomically. The explicit development clock's synchronous drain retains
oldest-first selection.

CT's 250 µs / 2 ms cooperative budgets, seven-times-thread-CPU pause capped at
100 ms, aged bulk opportunities, FIFO engine admission, detached readers and
ordinary thread priority are unchanged. No observation concurrency, retry,
answer retention, authority, transaction-size or wasm budget is relaxed.
The change does not promise a deadline under unbounded arrivals, thousands of
independent pending items, OS starvation or indivisible storage work.

## Scope and calibration relationship

Inputs were calibration [#30 d-03](../../../benchmarks/runs/2026-10-03-snapback4-clique-astra-0.4.12/astra/grader-report.json)
and [#29 d-03](../../../benchmarks/runs/2026-10-02-snapback4-clique-astra-0.4.11/astra/grader-report.json),
CT round 4, BG, RL and the shelved/reverted LV experiment. The active client
contract is LLP 3000.023, including PQ/RV, not the reverted LV model.

This measures the public web-device/React path on a reduced schema, **not the
frozen calibration application**. The grader's separate 63/63/129 ms API probe
does not timestamp the same browser attempts that took 15–17 seconds. This
experiment establishes a reproducible platform cause of that class of delay;
it does not establish that this cause accounts for those exact Mac attempts.
The separate large replay [delivery-throughput issue](../../../issues/20261002-snapback4-following-replay-delivery-backlog.md)
remains open; rotating work is not a qualification of replay service capacity.

## Harness and measurement custody

`tools/schema.q` contains public posts/reposts, owner-written follow edges,
the guide's materialized Following view with projected cards, a member-gated
group history and through-message reactions. Three isolated Chromium contexts
run `createLocalClient`, `webDevice()`, IndexedDB and React `usePage`. Alice
writes; Bob and Carol render independently. All three queries stay mounted.
No private evaluator, polling application hook or explicit per-update sync is
used. Startup alone syncs and drains setup work.

The backlog experiment preloads 1,000 posts. Before each measured repost,
message or reaction, Bob unfollows and refollows Alice, creating ordinary
durable cleanup/backfill work. Twenty writes per shape per load give 180 writes
and 360 remote observations per revision. The steady control has no history or
refollow transition and uses thirty writes per cell. Both revisions use the
same schema, browser, client package, load counts and CPU assignment. These are
closed-loop writes; a faster revision accepts the next trial sooner, so it can
have more old work still pending.

Formal comparisons use CPUs **80–89**, ten distinct physical cores. Load levels
are zero, twenty and 120 permanently runnable workers: zero, two and twelve
workers per CPU. The last corresponds to the scheduling pressure of a ten-core
host at roughly 120 runnable tasks. Workers, server, Node and browser descendants
inherit that affinity. A six-core exploratory pilot and the two-core suite
witness use only **90–95**. Thus this lane's complete experiment allocation is
sixteen CPUs, 80–95. Other tenants are not controlled; “idle” below means **no
injected burners**, not an exclusive quiet machine. Confined `/proc/stat`
counters and whole-host load averages accompany each run. CT can select its
contended budget from whole-host load even when this lane has no burners.

Burners belong to their own keeper-created process group. EOF triggers group
termination and reaping. No machine-wide burner or process-name kill is used.
No Apartment mini, office M1, M5 or other remote machine is used. Nothing is
pushed or published.

The production-profile measurement binaries add temporary post-commit,
delivery-chunk and pre-notification timestamps. The helper restores source in a
`finally` block; no trace hook is in shipping code. Browser wrappers timestamp
change and sync responses, device/wasm calls, IndexedDB transactions, matching
observation publication and the React layout effect displaying the update.
All use Unix milliseconds on the same host. Instrumentation is not free, but
both server revisions have the same stamps and client wrappers.

The baseline wrapper missed an explicit matching-evaluation stamp for server
fallback. Its replay uses the last corresponding HTTP query response at/above
the source sequence before the matching observation; that is a completion
proxy, not an extra server execution timestamp. The candidate additionally
stamps matching decoded fallback data. Missing stages remain absent. A sync or
query can finish before its long-poll response; these stages overlap and must
not be added as serial durations. For a repost, relevant delivery is the final
copy of that **fresh event**, not completion of all historical work. Message
and reaction delivery is part of their source commit.

Percentiles use nearest rank. Primary render latency uses the slower of two
remote viewers for each write; per-stage tables pool both viewers. Wasm,
IndexedDB and whole-device wall spans overlap and include descheduling, not
just CPU consumption. Full event streams remain in ignored `target/`; compact
summaries and per-update stage timestamps are retained with this report.

Reproduction commands and tool details: [tools/README.md](./tools/README.md).
Orientation record: [CONTEXT.md](./CONTEXT.md).

## Measurements

**Heavy-load target met for all three shapes; idle repost target missed.** At twelve runnable workers per CPU, slower-remote p95 improves from 36,389.7 to 1,788.2 ms for reposts, 1,917.0 to 932.4 ms for messages and 2,279.1 to 622.1 ms for reactions. The candidate idle repost p95 is 929.3 ms, above 500 ms. Its heavy repost maximum is 2,054.0 ms; the target is a p95, not a maximum guarantee.

### Commit to React, milliseconds

Twenty writes per cell; slower receiver per write. No rejected trials or missing browser renders.

| Workers | Shape | Before p50 | Before p95 | Before max | After p50 | After p95 | After max |
|---:|---|---:|---:|---:|---:|---:|---:|
| 0 | repost | 14687.5 | 16682.2 | 27666.1 | 236.0 | 929.3 | 992.6 |
| 0 | message | 226.1 | 346.7 | 424.6 | 145.0 | 262.8 | 322.6 |
| 0 | reaction | 100.0 | 191.4 | 199.9 | 32.0 | 46.4 | 51.5 |
| 20 | repost | 17268.1 | 28640.8 | 31657.1 | 179.1 | 490.3 | 672.9 |
| 20 | message | 279.0 | 472.8 | 605.0 | 109.6 | 452.8 | 469.0 |
| 20 | reaction | 333.5 | 563.4 | 579.5 | 102.1 | 165.5 | 173.3 |
| 120 | repost | 23203.8 | 36389.7 | 46371.1 | 592.8 | 1788.2 | 2054.0 |
| 120 | message | 1068.0 | 1917.0 | 2294.9 | 293.3 | 932.4 | 1520.8 |
| 120 | reaction | 1320.3 | 2279.1 | 2764.5 | 345.9 | 622.1 | 650.7 |

### Stage p95, milliseconds

Each cell pools forty receiver observations. Publication is the server notification for the relevant delivery cut; receipt is the first decoded change, sync or corresponding query response proving that cut or a later one. The long-poll-only and sync timestamps can be absent when another channel wins; their sample counts are retained in the JSON. One idle baseline recipient gets its copy before final fan-out completes and has no final-cut receipt within its render window (receipt n=39); every other cell has forty. Query completion uses the evaluation convention above (baseline fallback proxy marked **\***). These are overlapping measurements; percentiles cannot be added. The summaries retain p50, p95, maximum and count for every stage, including first source notice, sync, wasm, IndexedDB, device work and observation queue/attempt inspection.

| Revision | Workers | Shape | Commit→delivery | Commit→publish | Publish→receipt | Commit→query* | Query→observation* | Observation→React |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| before | 0 | repost | 16654.6 | 16654.8 | 45.9 | 16680.3 | 5.9 | 1.0 |
| before | 0 | message | 0.0 | 0.1 | 41.0 | 88.7 | 296.2 | 1.2 |
| before | 0 | reaction | 0.0 | 0.1 | 68.2 | 165.5 | 12.4 | 1.1 |
| before | 20 | repost | 28421.2 | 28421.4 | 145.2 | 28635.5 | 10.7 | 5.5 |
| before | 20 | message | 0.0 | 0.1 | 169.1 | 309.9 | 339.4 | 4.2 |
| before | 20 | reaction | 0.0 | 0.1 | 234.4 | 542.1 | 23.7 | 11.7 |
| before | 120 | repost | 35976.5 | 35976.6 | 525.5 | 36380.7 | 29.0 | 10.5 |
| before | 120 | message | 0.0 | 0.1 | 1267.1 | 1312.6 | 1011.3 | 10.4 |
| before | 120 | reaction | 0.0 | 0.1 | 908.9 | 1840.6 | 50.3 | 25.7 |
| after | 0 | repost | 34.4 | 34.6 | 23.0 | 42.3 | 783.0 | 0.8 |
| after | 0 | message | 0.0 | 0.1 | 14.1 | 15.6 | 233.0 | 0.8 |
| after | 0 | reaction | 0.0 | 0.1 | 21.0 | 45.0 | 1.2 | 0.6 |
| after | 20 | repost | 29.4 | 29.5 | 64.3 | 79.5 | 247.8 | 2.7 |
| after | 20 | message | 0.0 | 0.1 | 49.8 | 67.5 | 221.0 | 3.3 |
| after | 20 | reaction | 0.0 | 0.1 | 80.1 | 160.1 | 13.4 | 8.6 |
| after | 120 | repost | 45.0 | 45.1 | 310.5 | 325.4 | 1161.5 | 12.1 |
| after | 120 | message | 0.0 | 0.1 | 256.9 | 260.5 | 617.8 | 3.5 |
| after | 120 | reaction | 0.0 | 0.1 | 276.4 | 553.1 | 57.2 | 20.7 |

The original repost spends nearly all its long tail before delivery: delivery p95 is 16.65 / 28.42 / 35.98 seconds at 0 / 20 / 120 workers. Candidate delivery p95 is 34.4 / 29.4 / 45.0 ms. The p95 number of earlier delivery chunks falls from 1,611 / 1,576 / 1,370 to 3 / 2 / 0. A finite queue of long items was being drained serially; rotating bounded slices removes that wait.

The remaining candidate idle delay occurs after the query can return the fresh row. Idle repost trial 5 delivers at +1.3 ms, decodes a matching query reply at +21.3 ms and renders at +992.6 ms. Query replies continue throughout. Its observation queue p95 is only 0.5 ms. The traces and the existing change-version/authority checkpoints point to repeated invalidation before publication, rather than observation capacity or an expensive single wasm query. That attribution is an inference from the event sequence and guards, not a new internal discard-reason trace. The [follow-up issue](../../../issues/20261003-snapback4-live-query-publication-starves-during-following-backfill.md) records the residual target miss. A sound change must distinguish revocation, predictions and mixed local/server cuts; changing those guards is not a cheap retry tweak. No client change is included.

Read protection remains structurally unchanged and the observed HTTP query round-trip tails do not regress in this workload. Heavy-load p95 is 83.4→80.6 ms for home, 106.5→73.3 ms for message trials and 101.1→75.8 ms for reaction trials. These include transport/browser scheduling and pool all query operations during the named trial; they are not a replay of CT's whole read benchmark. The complete suite exercises CT's existing maintenance/admission regressions.

### Observed contention

All controlled workers remain on the same ten CPUs. Whole-host load differs because other lanes continue working and a much shorter candidate run does not give a one-minute average the same settling time. CPU pressure, rather than that global average alone, defines the controlled level.

| Revision | Workers | Confined busy p50 / p95 (%) | Host load p50 / p95 / max |
|---|---:|---|---|
| before | 0 | 68.2 / 83.0 | 31.4 / 48.9 / 54.2 |
| before | 20 | 99.9 / 100.0 | 69.2 / 101.9 / 102.5 |
| before | 120 | 100.0 / 100.0 | 142.7 / 192.6 / 196.6 |
| after | 0 | 62.3 / 69.1 | 47.1 / 56.9 / 56.9 |
| after | 20 | 99.8 / 100.0 | 37.8 / 38.8 / 38.8 |
| after | 120 | 100.0 / 100.0 | 108.4 / 132.8 / 133.9 |

A live `/proc` audit during the baseline heavy phase found 133 owned processes, all with affinity 80–89 ([snapshot](./before-affinity.json)); none remained after cleanup. Baseline and candidate formal runs exited zero, with all 180 writes/360 remote observations and no page errors. Shared host noise and the closed-loop arrival-rate difference limit exact causal speedup ratios; the deterministic FIFO control independently identifies the selection defect.

### Steady-state control

Thirty writes per cell, no injected history/backfill transition, the same ten CPUs and worker counts. This control did not reproduce seconds of latency on the original implementation. All candidate cells remain below 500 ms at p95, including heavy load. Values below are slower-remote commit-to-render p95 in milliseconds; the linked summaries retain every stage.

| Workers | Shape | Before | After |
|---:|---|---:|---:|
| 0 | repost | 58.3 | 53.7 |
| 0 | message | 42.3 | 32.5 |
| 0 | reaction | 29.7 | 25.0 |
| 20 | repost | 96.9 | 119.7 |
| 20 | message | 104.8 | 99.2 |
| 20 | reaction | 71.8 | 80.8 |
| 120 | repost | 297.9 | 264.1 |
| 120 | message | 300.4 | 265.3 |
| 120 | reaction | 208.8 | 175.4 |

[Before steady summary](./before-steady.summary.json); [after steady summary](./after-steady.summary.json) and [after timestamps](./after-steady.stamps.csv).

### Retained evidence

- [Before summary](./before-qualified.summary.json) and [timestamps](./before-qualified.stamps.csv).
- [After summary](./after-qualified.summary.json) and [timestamps](./after-qualified.stamps.csv).
- [Suite latency](./suite-latency.json), [verification](./verification.json) and [artifact hashes](./artifacts.json).
- Full raw streams remain in this worktree's ignored `snapback4/target/lu-*.json.jsonl`; their sizes/hashes are in `artifacts.json`. No file above 256 KB, gzip trace or movie is committed.

## Verification and development record

The deterministic Rust regression contrasts the original FIFO selector with
the new background selector at a zero time budget, forcing one recipient per
turn. FIFO is still blocked after nine turns; the new selector reaches both
followers in six turns with two backfills still pending. It asserts at most
two row writes per turn, exact final rows, stage order and a generous 60-second
hang bound. Further cases cover declaration rotation, clock rewind, removal,
unfollow/refollow epochs, restart and adoption. The affected run passed all
five new tests and all seventeen existing timeline-background tests.

The Linux suite witness adds real headless Chromium with an ordinary debug
server and two confined burners. It checks all three shapes, commit → matching
evaluation → observation → render, and a generous 120-second hang bound.
The existing server trace supplies the commit timestamp. The test deliberately
does not assert the performance qualification thresholds in a shared-host suite.
The deterministic engine tests also run on non-Linux hosts.

Development failures were retained, not silently counted as qualification:
the first seed attempted forbidden timeline import and was replaced by real
mutations; a large pretty-printed trace hit Node's string-size limit and led to
streamed JSONL plus unconditional cleanup; two restart-fixture attempts used a
non-private SQLite parent and were corrected to an owned temporary directory.
The failed trace run's only surviving server was confirmed as this lane's own
recorded process and terminated by its exact PID. The final keeper protocol
always reaps owned burners. Occasional React development warnings about updating
a component during render were observed; no browser page errors were recorded
in the completed qualification cells. No unrelated client fix is inferred.

The full suite found the feeds guide one line above its fixed 401-line budget.
The wording was shortened without dropping the scheduling explanation, and
the complete guide target then passed 112/112. The full invocation completed with that sole failure: exit 1, 1,595 seconds.
All remaining categories passed: 6,035 client tests (11 skipped), all 79 client
models, the fixture wrappers, typechecks, release guard and wasm budget. The
112-test guide rerun covers the only source correction made during the suite.
This is a complete suite plus a passing affected rerun, not a claim that the
original invocation exited zero.

Command: `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT LU_TEST_CPUS=90-91
taskset -c 0-31,48-79 bash snapback4/scripts/test.sh` from the repository root.
The suite used separate physical cores from CPUs 80–95 (including excluding
their SMT mates 32–47); its new contention witness moved to 90–91. The ordinary
client file pool used the unmodified affinity-aware limit of 21.

Canonical locked wasm builds before and after measure **2,048,676 raw / 617,398
gzip bytes**. The final wasm SHA-256 is in `artifacts.json`. The unchanged 618,040-byte cap leaves
642 bytes, preserving the existing 130-byte estimated macOS offset and more
than 500 bytes beyond it. No macOS measurement is claimed. Node 24.13.1, Bun
1.3.14, Rust 1.97.0 and Chromium 151.0.7922.34 were used.

`./ref-check --verbose` passed with 527 documents, 10,286 references, zero
errors and zero unchecked references. `git diff --check` also passed. The
reference and whitespace checks are repeated after the final report/journal
updates. No push or publication is part of this lane.
