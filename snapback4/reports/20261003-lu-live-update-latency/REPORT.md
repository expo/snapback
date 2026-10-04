# LU — live updates during contended Following backfill

Date: 2026-10-03. Branch: `sb4-intent/lu-live-update-latency`.
Control: `7c9c0c0dabb0528cdee438222bb7eec46e828f16` (origin/main at worktree creation).
Host: eb1000, Linux, AMD EPYC 9454, 48 physical / 96 logical CPUs.

**Round-1 correction:** round 0's taskset-only browser confinement was incomplete;
Chromium software-GPU threads can reset their mask. Its historical results are
retained below, but are not fully CPU-confined qualification. Round 1 uses a
verified inherited affinity lock; see the confinement correction below.

## Finding and change

The commissioned small social fixture exposes a server head-of-line delay:
background delivery repeatedly selects the oldest pending work item until it
finishes. A new two-follower repost can wait behind over a thousand backfill and
cleanup transactions. Most of its commit-to-render interval precedes the
follower-delivery commit. Without backfill, the original implementation already
delivers these small updates well below the requested thresholds.

Round 0 used a forward-key selector, with an in-memory last-served position.
Both reviews demonstrated that continuing fresh arrivals could prevent its
wrap forever. Its original claim that large backfills and cleanup continue
progressing was incorrect. **Round 1 replaces that selector with a durable
queue: an item among P pending items gets a slice within P visits to its
declaration, or D×P successful delivery turns across D fixed declarations.**
New arrivals and serviced unfinished items append behind all pending work.
See the Round 1 section below for the proof, scope and matched remeasurement.
The remaining original measurements below describe round 0, not the correction.

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
were launched with that affinity (the round-1 thread audit found a GPU-worker
escape, corrected below). A six-core exploratory pilot and the two-core suite
witness use only **90–95**. Thus this lane's complete experiment allocation is
sixteen CPUs, 80–95. Other tenants are not controlled; “idle” below means **no
injected burners**, not an exclusive quiet machine. Confined `/proc/stat`
counters and whole-host load averages accompany each run. CT can select its
contended budget from whole-host load even when this lane has no burners.

Burners belong to their own keeper-created process group. EOF triggers group
termination and reaping. No machine-wide burner or process-name kill is used.
No Apartment mini, office M1, M5 or other remote machine is used. Nothing is
pushed or published. See the Round 1 confinement correction for the browser
thread-mask exception discovered after this original run.

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

## Round 1 — bounded service during continuing arrivals

Date: 2026-10-04. Both round-0 reviews were NOT READY on P1. Astra held
Bob's 120-post backfill at 51 copies through 200 new one-follower deliveries;
Grok independently reproduced starvation with 30 posts. The same selector served
the aged bulk opportunity, so the one-second path was not a rescue. The reviews
also confirmed atomic rollback/restart, CT service, the retained latency data,
and a clean full-suite run after the guide correction (3,338 seconds). Those
review results qualify round 0 only.

The replacement is a durable round-robin queue. Enqueue uses one metered
reverse peek of the pending prefix in `byStatusTime`, and assigns the existing
`Work.at` field max(pending position)+1 (zero for an empty queue). Each background
turn selects the head. If unfinished, it saves its cursor and a new tail position
in the same transaction as its copies/deletions, epochs and sequence. The field
is now an internal queue position, not wall-clock enqueue time. This needs no
schema or index migration; legacy timestamp keys remain ordered positions.
Equal or backwards clocks cannot jump the queue. Integer exhaustion refuses
atomically. Explicit clock drains finish their queue head without requeuing it.

**Guaranteed bound:** freeze P, the number of pending items in a declaration,
at any time t when the item is pending (including immediately after a slice). That
item receives its next slice within P successful visits to the declaration,
regardless of newer arrivals. Every predecessor either leaves or moves behind
it; new arrivals also join behind it. With D fixed declarations, rotating
among declarations gives at most D×P successful background delivery turns.
Cancellation or refusal parking ends the obligation. New work can overtake
an unfinished item after its slice; it cannot pass that item repeatedly without
letting it run. Thus a large backfill or cleanup progresses at this stated
queue-size-dependent cadence, rather than at an unspecified rate.

This is not a fixed wall-clock deadline or an overload-capacity guarantee.
If arrivals consume all service capacity, the queue and successive P values
may grow. Failed commits, OS starvation, synchronous clock drains and atomic
storage costs do not promise elapsed-time progress. Queue positions survive
open/adopt; the next declaration remains a transient hint, so repeatedly
resetting that hint is outside the D-declaration bound. No CT admission,
CPU pacing, aged opportunity, read custody or resource ceiling changes.

### Continuing-arrival and ordering regressions

`timeline_fairness.rs` streams one new one-recipient delivery before every
background turn. For 400 turns it checks each target's frozen deadline; the
deadline never grows just because new work arrives. Cases cover five simultaneous
120-post backfills, cleanup after a 600-post history, a 40-recipient fan-out,
and two declarations with the D×P bound. Clocks alternate equal/backwards values.
Zero budgets force one candidate per slice and at most two row writes. A FIFO
control still completes the 120-post backfill with 200 concurrent arrivals.
Late transaction failure rolls back queue position with the other state;
reopen/adopt after every slice preserves progress during continued arrivals.

Arrival is not FIFO by event time. The explicit ordering case delivers a later
event to Carol while the earlier fan-out remains unfinished, then checks the
final page is `[later, earlier]` with exactly two copies. This is the existing
sorted, duplicate-free delivered-contents contract, not an arrival watermark.
The React page regression feeds a later event first and an earlier event in a
subsequent ordered snapshot, including overlap with a second page; it retains
query order and unique IDs.

Client audit: `react-pages.ts` reconciles current query snapshots, drops a suffix
when its predecessor cursor changes, and deduplicates row IDs; it does not append
rows in delivery order. `local-following.ts` tracks the caller's pending edge
intent and settlement, not remote event notification counts. Web and Expo chat
`Inbox.tsx` render query counts, while both `Thread.tsx` files render `usePage`
items. No SDK or included chat “new post” toast increments on event arrival.
The retained calibration #30 backend computes `unread` from message ordinals and
membership boundaries, and `digestFollowing`/`digestUnread` from source queries
and time ranges; they do not count delivered inbox events. The archive contains
backend source only, so this does not claim an audit of the unavailable frozen
application UI. An app implementing its own delivery-order watermark would need
to change; the platform does not provide that ordering contract.

### Matched remeasurement and verification

The same harness, 1,000-post history, refollow before each update, three Chromium
clients, and 0/20/120 burners on CPUs 80–89 are used for the original FIFO baseline
and round-1 candidate. Each cell has 30 writes and 60 remote renders;
the primary statistic takes the slower receiver per write. The client build is
frozen for both runs, so the concurrent full suite cannot replace it mid-run.
Builds/full-suite ordinary work use CPUs 0–31,48–79; the suite contention witness
uses 90–91, within the overall 80–95 experiment allocation. Neither burners nor
experimental servers/browsers use the whole machine.

The final affected run passed 30 timeline tests (8 fairness, 5 original LU,
17 background) and all 112 guide tests. The six page-reconciliation tests also
passed. As a negative control, replacing only the scheduler/enqueue files with
round 0 made six of the eight fairness tests fail, including all four ongoing
service bounds; FIFO and final-page-order controls remained green. Its late-fault
case still passed atomic rollback and failed only the subsequent service-order
assertion. [Affected output](./round1/affected.log), [page tests](./round1/page-tests.log),
and [negative control](./round1/negative-control.log) retain the evidence.

Development corrections: the purge-before-delivery fixture previously rewound
wall time to select purge first; it now sets an internal trusted restore position
while keeping the original tombstone assertions. The first cleanup fixture was
small enough for synchronous unfollow to remove all copies, so it was expanded
to leave real pending cleanup. Initial test-helper compilation/type mistakes
were corrected before the passing run. The first frozen-client copy omitted
the package import map and failed before any samples or burners; that owned
run was stopped, all its descendants exited, and the corrected package layout
was restarted. None of these failed setup/development attempts contributes to
the latency qualification.

### Confinement correction

A thread-level audit during the first round-1 baseline found 16 Chromium
SwiftShader GPU-process threads on CPUs 0–9, despite the browser's parent and
other threads being on 80–89. Thus taskset inheritance alone did not establish
this lane's CPU boundary. The run was stopped; its 30 no-burner trials and partial
20-burner cell are **excluded** from round-1 qualification and retained only as
ignored `target/lu-r1-before-unconfined.*`. This also withdraws round 0's blanket
claim that every browser thread remained confined; its process-launch masks did
not prove that claim. No burner escaped its owned CPU set.

The user-level systemd AllowedCPUs probe did not enforce a cpuset on this host.
`tools/confine.py` therefore installs an unprivileged seccomp filter after
taskset and before exec: it refuses affinity-changing syscalls, self-tests that
refusal, and leaves the chosen mask in force through forks, threads and exec.
[Linux documents that filter inheritance](https://docs.kernel.org/userspace-api/seccomp_filter.html).
It rejects unexpected syscall ABIs and checks the initial mask has at most
16 CPUs. It changes no rendering flags or product code. The formal harness and
suite witness now require this launcher. Thread audits in [affinity.json](./round1/affinity.json)
check the server, browser, Node and owned burners; the first corrected audit
found all 284 threads on 80–89, including the software GPU pool.

A fresh before/after run uses the same production binaries, frozen SDK,
1,000-post history, 30 trials per shape and 0/20/120 workers with this guard
on both revisions. The 80-post confinement pilot is separate from qualification.
The full suite had not reached client tests when its witness launcher was
corrected, so its browser witness executes the guarded version.

The broader audit of other browser harnesses is tracked in
[the confinement follow-up](../../../issues/20261004-snapback4-chromium-affinity-escape.md).
Build/suite launch masks are not an exclusive reservation against other tenants
or proof about every unrelated test browser's threads. The formal experiment's
own complete descendant tree is the guarded and audited scope.

### Round 1 full verification

The required full suite completed **exit 0, zero failures in 1,899 seconds**.
It passed the complete Rust workspace and doctests, all 112 guide tests,
9 fixture wrappers, package/chat/Expo typechecks, docs budget and release guard,
6,036 client tests (11 skipped), and all 79 client models. The new eight fairness
cases and the existing five LU/seventeen background cases passed in this full
run. The guarded Chromium contention witness passed in 15.1 seconds; its pooled
four-observation p95 at 0/2 burners was 202.9/249.4 ms for repost, 362.6/376.1 ms
for message, and 126.9/179.6 ms for reaction. These tiny witness cells assert
stage ordering and generous bounds; they are not the formal latency estimate.

Command from the repository root:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=16 \
LU_TEST_CPUS=90-91 taskset -c 0-31,48-79 bash snapback4/scripts/test.sh
```

[Suite summary](./round1/suite-summary.log), [witness percentiles](./round1/suite-contention.log)
and [artifact hashes](./round1/artifacts.json) retain compact evidence. The full
log is ignored at `snapback4/target/lu-r1-full-suite.log`. Runtime sources were
fixed throughout this suite. The measurement/witness launcher correction was
made before its client phase began, so the full invocation covers that final
harness too. No failed suite category is being replaced by an affected rerun.

The fresh locked wasm build remains **2,048,676 raw / 617,398 gzip bytes** with
the fresh build digest in `round1/artifacts.json`. Its digest differs from the
frozen round-0 client used identically for both latency runs; equal byte sizes
do not imply identical artifacts. The unchanged 618,040-byte cap leaves 642 bytes:
130 for the existing estimated macOS offset and 512 beyond it. No macOS build
or budget increase is claimed.


### Final guarded measurements

Both runs completed without page errors: 270 writes and 540 remote renders per
revision, 30 writes for each shape/load cell. Nearest-rank percentiles use the
slower of the two receivers per write. The comparison is the original FIFO
runtime against the round-1 scheduler; round 0 is covered separately by the
negative control above. [Before summary](./round1/before.summary.json),
[after summary](./round1/after.summary.json), [before timestamps](./round1/before.stamps.csv)
and [after timestamps](./round1/after.stamps.csv) retain all cells. Large event
streams remain ignored under `target/lu-r1-{before,after}.json.jsonl`, with sizes
and SHA-256 digests in the artifact manifest.

Primary latency, milliseconds, slower receiver per write; n=30 per cell.

| Burners | Shape | Before p50 / p95 / max | Round 1 p50 / p95 / max |
|---:|---|---:|---:|
| 0 | repost | 14,279.0 / 15,900.9 / 16,341.4 | 129.8 / 757.7 / 780.0 |
| 0 | message | 99.1 / 596.5 / 640.0 | 93.6 / 265.4 / 343.3 |
| 0 | reaction | 107.0 / 278.9 / 281.2 | 31.6 / 46.9 / 59.0 |
| 20 | repost | 16,090.5 / 19,292.2 / 19,855.6 | 251.5 / 878.6 / 930.3 |
| 20 | message | 304.0 / 554.7 / 567.8 | 133.1 / 261.0 / 387.2 |
| 20 | reaction | 445.4 / 690.4 / 724.0 | 122.3 / 166.3 / 188.0 |
| 120 | repost | 21,337.1 / 24,645.0 / 24,649.9 | 383.8 / 892.1 / 1,222.1 |
| 120 | message | 1,340.0 / 2,160.9 / 2,214.2 | 340.1 / 1,485.5 / 1,596.1 |
| 120 | reaction | 1,702.5 / 2,278.6 / 3,006.9 | 401.5 / 657.5 / 672.8 |

Per-stage p95, milliseconds from commit, pooling both receivers (n=60; see JSON for missing-stage counts). Delivery is the fresh event's final copy, not the end of historical bulk. These overlap; do not add them.

| Revision | Burners | Shape | Delivery | Published | Received | Evaluation | Render |
|---|---:|---|---:|---:|---:|---:|---:|
| FIFO | 0 | repost | 15,864.2 | 15,864.3 | 15,871.8 | 15,868.6 | 15,871.5 |
| FIFO | 0 | message | 0.0 | 0.1 | 51.7 | 55.8 | 379.0 |
| FIFO | 0 | reaction | 0.0 | 0.2 | 92.9 | 204.0 | 217.2 |
| FIFO | 20 | repost | 19,143.5 | 19,144.2 | 19,168.4 | 19,173.2 | 19,260.5 |
| FIFO | 20 | message | 0.0 | 0.1 | 329.5 | 353.2 | 496.8 |
| FIFO | 20 | reaction | 0.0 | 0.2 | 286.3 | 594.0 | 597.7 |
| FIFO | 120 | repost | 24,271.2 | 24,271.3 | 24,309.5 | 24,310.1 | 24,424.7 |
| FIFO | 120 | message | 0.0 | 0.1 | 1,413.7 | 1,700.2 | 1,800.5 |
| FIFO | 120 | reaction | 0.0 | 0.1 | 997.2 | 2,269.5 | 2,270.6 |
| Round 1 | 0 | repost | 55.3 | 55.4 | 57.8 | 51.5 | 587.0 |
| Round 1 | 0 | message | 0.0 | 0.1 | 20.0 | 21.9 | 194.5 |
| Round 1 | 0 | reaction | 0.0 | 0.1 | 17.5 | 41.0 | 43.8 |
| Round 1 | 20 | repost | 41.0 | 41.1 | 92.5 | 87.9 | 593.5 |
| Round 1 | 20 | message | 0.0 | 0.1 | 90.1 | 94.9 | 219.0 |
| Round 1 | 20 | reaction | 0.0 | 0.1 | 77.6 | 155.4 | 159.2 |
| Round 1 | 120 | repost | 77.7 | 77.9 | 314.1 | 324.4 | 804.8 |
| Round 1 | 120 | message | 0.0 | 0.2 | 258.8 | 278.2 | 836.3 |
| Round 1 | 120 | reaction | 0.0 | 0.1 | 289.5 | 571.2 | 575.0 |

Observed scoped CPU busy percent and whole-host one-minute load (p50 / p95).

| Revision | Burners | Ten-CPU busy % | Host load |
|---|---:|---:|---:|
| FIFO | 0 | 71.5 / 82.6 | 25.9 / 36.0 |
| FIFO | 20 | 100.0 / 100.0 | 37.3 / 78.0 |
| FIFO | 120 | 100.0 / 100.0 | 134.7 / 165.7 |
| Round 1 | 0 | 64.2 / 71.1 | 45.8 / 56.5 |
| Round 1 | 20 | 99.9 / 100.0 | 33.5 / 35.2 |
| Round 1 | 120 | 100.0 / 100.0 | 112.4 / 126.0 |

“0 burners” is the no-injected-load condition, not an otherwise idle machine.
Other lanes and browser work still consume CPU. Both injected levels saturate
the chosen ten CPUs; 120 runnable burners reproduce roughly twelve CPU-bound
workers per core. The whole-host load is context, not the confinement boundary,
and differs across sequential runs. These are matched settings on a shared
host, not a claim of identical background tenants or a controlled whole host.

Stage timestamps use the conventions in the round-0 method: evaluation is a
matching device result or an HTTP completion proxy before matching observation.
Receipt proves the final delivery cut, while one receiver can evaluate its own
copy before the other receiver's copy completes. Hence evaluation can precede
that receipt, and stage p95s need not form an increasing sequence. Missing
channel stamps and counts remain in the summaries; no absent channel is filled
with zero. Final-cut receipt has 57 observations for FIFO's no-burner repost
cell and 59 for round 1's 20-burner repost cell; all other main stages have 60.
Message and reaction delivery are their source commit because they
do not use Following fan-out.

The repost bottleneck remains clear after restoring fairness. At heavy load,
pooled commit-to-final-copy p95 falls from **24,271.2 to 77.7 ms**; the primary
slower-receiver commit-to-render p95 falls from **24,645.0 to 892.1 ms**.
Publication follows delivery promptly. A new small event can complete after
older work receives one bounded slice, while the continuing-arrival tests ensure
that unfinished work receives its frozen P-visit share. CT pacing and admission
remain unchanged; the round-0 reviewers' mixed read/lease/deadline witness is
historical evidence, not a newly repeated round-1 mixed benchmark.

All three heavy-load primary p95s meet the two-second target in this run:
repost **892.1 ms**, message **1,485.5 ms**, reaction **657.5 ms**. Message maximum
is **1,596.1 ms**, versus **2,214.2 ms** for FIFO. This is a smaller and more
variable improvement than the repost result. Astra's round-0 message maximum
rose from 0.64 to 1.87 seconds, so neither that review nor this 30-trial sweep
supports a universal message speedup. The complete p50/p95/max cells above,
including the no-burner condition, are the claim.

The no-burner repost p95 **757.7 ms** still misses the 500 ms target. Its slowest
trial (23, Carol) delivers at +39.4 ms, publishes at +39.5 ms, receives evidence
at +42.7 ms and evaluates at +43.0 ms, but publishes the matching observation at
+779.4 ms and renders at +780.0 ms. The observation queue p95 is 0.1 ms and
attempt p95 15.7 ms. The interval between evaluation and observation publication
is 736.4 ms. Overlapping wasm/device/IndexedDB spans are retained in the summary;
they must not be summed. This remains consistent with repeated invalidation
before observation publication, not proof of a particular internal discard
reason. The existing [publication follow-up](../../../issues/20261003-snapback4-live-query-publication-starves-during-following-backfill.md)
now carries this guarded reproduction. No retention, withdrawal or authority
bound was weakened to hide the residual.

Final reference audit: 527 LLP documents, 10,288 references, zero errors and zero
unchecked references. Whitespace checks pass. Every newly retained artifact is
below 256 KB; no raw trace, gzip or movie is staged. Both formal measurement
processes exited normally and their owned burners were reaped. Nothing is pushed.
