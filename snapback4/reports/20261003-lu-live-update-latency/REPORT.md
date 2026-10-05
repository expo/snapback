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

The remaining candidate idle delay occurs after the query can return the fresh row. Idle repost trial 5 delivers at +1.3 ms, decodes a matching query reply at +21.3 ms and renders at +992.6 ms. Query replies continue throughout. Its observation queue p95 is only 0.5 ms. The traces and the existing change-version/authority checkpoints point to repeated invalidation before publication, rather than observation capacity or an expensive single wasm query. That attribution is an inference from the event sequence and guards, not a new internal discard-reason trace. The [follow-up issue](../../../issues/closed/20261003-snapback4-live-query-publication-starves-during-following-backfill.md) records the residual target miss. A sound change must distinguish revocation, predictions and mixed local/server cuts; changing those guards is not a cheap retry tweak. No client change is included.

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
reason. The existing [publication follow-up](../../../issues/closed/20261003-snapback4-live-query-publication-starves-during-following-backfill.md)
now carries this guarded reproduction. No retention, withdrawal or authority
bound was weakened to hide the residual.

Final reference audit: 527 LLP documents, 10,288 references, zero errors and zero
unchecked references. Whitespace checks pass. Every newly retained artifact is
below 256 KB; no raw trace, gzip or movie is staged. Both formal measurement
processes exited normally and their owned burners were reaped. Nothing is pushed.


## Round 2 — wide replay fan-out under contention

Date: 2026-10-04. The reported 0.4.13 Darwin dry run failed the unchanged
`replay_delivers_900_followers_promptly_after_commit_without_schedules` test
at its 60-second wake guard, and an upload test at its three-second socket
read timeout. This round uses eb1000 only. `origin/main` merged cleanly by
fast-forward to **2cc55e168c9fa3297aa321793987f480be8406e3**, including RP, QE2,
NL, WD, QF and QF2. The exact pre-LU control is **848b645294^1 =
4353aa735cb1c752d08993268da9fa8a75f26c5c**, built in a separate local worktree.
No Darwin machine was used and neither timeout was enlarged.

### Reproduction and cause

The proposed 900-backfill/cleanup explanation does not match this fixture.
All 900 follows occur before any post exists. `timeline/online.rs` enqueues a
backfill only beyond the synchronous 50-event preview, and cleanup only beyond
256 existing copies. Both queues are empty here. The trace shows only the one
live delivery, starting within milliseconds of the source commit. The new
regression also asserts zero pending items after these follows, then exactly
one after posting. Thus the seconds are spent finishing the fan-out, not waiting
for 900 other tasks.

The exact replay and upload tests were repeated on pre-LU and current main,
five replay trials and ten upload trials per revision/load at 0/20/120 owned
burners. All **30 replay and 60 upload runs passed** on Linux. The Darwin timeout
itself is not reproduced; these results cannot establish its platform-specific
cause. At heavy load, the replay test's maximum was 22.224 seconds pre-LU and
24.638 seconds on main. A current-main ablation changes only the periodic
selector back to FIFO. It also takes many seconds, although it does not rotate
the unfinished fan-out. All these records remain separate from candidate tests.

Contended slices usually consume one recipient, while the old walk requests
32 candidates each time. A deterministic one-row slice examines 39 rows for a
wide population versus eight for a single recipient. The same unused suffix
is repeatedly decoded and metered, then its CPU cost is multiplied by CT's
seven-times pacing. Each delivery slice also goes through empty recount and
job kinds; their separate short sleeps add scheduler wakeups under heavy load.
Requested CPU repayment and OS/admission delays are distinct: the trace records
charged CPU and requested pause sums, not an assertion that every sleep resumes
at its requested deadline.

### Change and invariants

The delivery walk starts with two candidates and grows 2→4→8→16→32 only while
the current turn can consume more. Two preserves one-row completion lookahead.
All actual candidates keep ordinary row/rule/meter checks; only consumed rows
advance the durable cursor. There is no task class, index, schema or admission
change. The 256-candidate chunk limit, 250 µs/2 ms cooperative deadline and
atomic commit remain. At a zero budget the 900-follower regression still writes
one recipient per turn and completes in 900 turns, with 8,997 examined rows.
The wide first-recipient cost stays within four rows of the single-recipient
cost; restoring main's old scan makes that assertion fail (39 versus eight).

CT still charges seven times consumed CPU with the 100 ms cap on each kind.
Empty-kind charges accumulate until the next useful slice or until debt reaches
100 ms; if a complete cycle is empty, they are repaid before the interruptible
idle wait. Work or error/parking triggers repayment immediately. Each repayment
is at most 100 ms, and any remainder carries forward. Engine custody ends
between every kind and before every sleep.
Request commits cannot cancel repayment. This avoids separate empty recount/job
wakeups while a delivery remains active, without discarding their CPU charge.
A deterministic test checks combined debt, empty-cycle repayment and aged
eligibility; another accounts for 240 ms of individually capped debt as
100 + 100 + 40 ms repayments. CT's existing atomic-overrun, clock, admission and expiry tests
remain in place.

Round 1's durable queue and exact frozen-P guarantee are unchanged: any item
pending among P items gets a slice within P visits to its declaration, or D×P
successful background turns across D fixed declarations. Small new deliveries
still overtake unfinished history; the continuing-arrival, cleanup, multi-slice
fan-out, epoch, rollback, restart and ordering tests remain. Later event arrival
can precede earlier event arrival, with sorted, duplicate-free query pages.

A fan-out to W recipients requires W copies. These changes reduce wasted work
and wakeups and qualify last-recipient latency for the requested 900-recipient
shape. They do not promise a physical completion time independent of unbounded
W, unbounded arrival rate, storage delays or OS starvation. LLP 3000 §7 and
LLP 3000.013 §4 state that scope explicitly.

### Measurement custody

Every native comparison and browser experiment runs on the same ten physical
CPUs, **80–89**, through `taskset` and the inherited affinity guard from round 1.
Only one injected-load experiment runs at a time. Burners use the same owned
keeper/process group, reaped before the next experiment. Builds and ordinary
suite work launch on 0–31,48–79; the suite browser witness uses 90–91. No process
name/pattern is signaled and no other machine is used.

`tools/replay-build.py` temporarily stamps source commits, successful work
commits and pacing decisions, builds the ordinary test-profile server plus the
original replay/upload test executables, then restores sources in `finally`.
The replay executable's server path is selectable so successive builds cannot
replace its measured binary. The fixture, read loop and timeouts are unchanged.
`tools/replay-compare.py` alternates revisions per trial. Test elapsed time starts
before posting, as in the original test. The 900th-copy timestamp is the commit
where summed follower-copy writes reach 900; final task retirement can be a
later empty slice. The original test independently checks all 901 inbox copies
(including the author) and no jobs.

Traced native latency includes probe overhead: formatting/writing the stamps
and the work-row read used to report its durable cursor/completion. CT's CPU
charge includes that instrumentation. Both sides use the same probes, but the
numbers are not uninstrumented production latency or a Darwin qualification.
Affected tests and the complete suite use the ordinary uninstrumented binary.

Native cells use five trials (three for the FIFO/adaptive-only ablation), so
nearest-rank p95 is also the maximum. Zero burners means no injected load,
not a quiet host: CT's one-minute global load hint can remain contended after a
previous cell. That is visible in the retained load and pause records. Do not
compare the first run's initially quiet samples against a later contended cell
as if host conditions were identical.

The web comparison uses current main against round 2, the same freshly built
frozen SDK on both servers, 1,000 history rows, refollow before every update,
three independent Chromium contexts and 30 writes per shape/load. Primary
latency is the slower remote render per write; stage counts pool both receivers.
Production binaries contain measurement-only hooks, restored before affected
checks and the full suite. Raw logs and event streams remain under ignored
`target/lu-r2*`; compact tables, stamps and hashes are retained here.

### Upload finding

The upload test's schema has no Following declaration or queued delivery work.
Its two deliberately blocked upload workers leave the query engine free; the
third upload must be refused and a query must complete before release. No test
or upload implementation is changed. All ten trials per load/revision passed
with the original three-second socket timeout. Total test wall time rises from
roughly 32 ms with no injected burners to a heavy-load maximum of 411 ms pre-LU
and 408 ms on main. This demonstrates load sensitivity without reproducing the
Darwin socket timeout. It does not support a causal link to LU's delivery
selector; the exact Darwin failure remains unqualified on this Linux host.

### Development record

The first empty-kind repayment build used a nonexistent Result convenience
method and failed compilation; replacing it with `map_or` fixed the build
before any candidate test ran. The adaptive-only candidate and the main-FIFO
ablation are retained as exploratory comparisons. A first combined candidate
capped accumulated empty-kind debt, which could discard part of multiple
individually capped charges. The final candidate caps each charge and repayment,
carries the remainder and repays once empty debt reaches the cap. The new
240 ms conservation regression covers that edge. The exact initial
[maintenance patch](./round2/initial-maintenance.patch),
[native cells](./round2/main-combined.json),
[browser summary](./round2/web-initial.summary.json) and
[source/binary hashes](./round2/production-artifacts.json) remain historical
evidence; final measurements and full-suite qualification are rerun after the
correction. The negative scan control intentionally fails and is not
counted as a product test failure. No failed qualification is converted to a
pass by extending a deadline.

The first isolated witness control copied its test executable without the
expected sibling `snapback4` supervisor. Its ten main attempts refused at
startup with `No such file or directory`; no workload ran in those attempts.
The corrected directory layout uses the matching main server and passes ten
isolated repetitions. [Setup-attempt records](./round2/witness-control.json)
are separate from [valid comparisons](./round2/witness-valid-control.json).

The first full suite finished with **one failure in 1,788 seconds**, exit 1:
`recovery_volta_style_shim_drains_late_group_member` refused an invalid `/proc`
process-group field during idempotent cleanup. The CLI target had 282 passes,
one failure and four ignores; every other Rust target/doctest passed. Clients
passed 6,187 tests with 11 skips; models passed 79/79, fixtures 9/9, and all
build/typecheck/budget steps passed. [Result](./round2/initial-full-suite-result.json)
and [failure excerpt](./round2/initial-witness-failure.log) retain that outcome.

The witness source is unchanged by LU. The corrected isolated controls pass
10/10 on main and 10/10 on the initial candidate; two complete CLI unit runs
per revision also pass ([records](./round2/unit-control.json)). These controls
do not reproduce a baseline failure or explain the rejected snapshot. The
[native inspection ticket](../../../issues/20261004-snapback4-native-witness-proc-group-inspection.md)
keeps the failure open; no witness or ownership check is weakened. The final
candidate's complete suite is recorded separately below, after the CPU-debt
correction, without replacing this first result.

The final browser sweep's first launch was refused before creating clients or
burners: the affinity guard wrapped the experiment coordinator, whereas the
harness requires it to wrap Node directly and checks that PID. Relaunching
through `confine.py node ...` satisfies the existing guard. [The startup refusal](./round2/web-final-startup-refusal.log)
is retained separately; all final browser samples come from that fresh guarded
run. The first audit coordinator also reported an empty process tree after the
refused process had exited; it is not an affinity-escape observation. The final
browser audit uses the actual Node PID.

### Native replay numbers

Exact pre-LU versus merged main. [Individual records and hashes](./round2/prelu-main.json).

| Burners | Revision | n | Test elapsed p50 / p95 (s) | Commit→900th copy p50 / p95 (s) |
|---:|---|---:|---:|---:|
| 0 | prelu | 5 | 0.226 / 9.027 | 0.214 / 9.012 |
| 0 | main | 5 | 0.234 / 2.142 | 0.217 / 2.120 |
| 20 | prelu | 5 | 8.359 / 8.501 | 8.332 / 8.471 |
| 20 | main | 5 | 8.847 / 9.084 | 8.813 / 9.051 |
| 120 | prelu | 5 | 21.526 / 22.224 | 21.421 / 22.142 |
| 120 | main | 5 | 22.905 / 24.638 | 22.799 / 24.554 |

Current-main FIFO and adaptive-only ablation. [Individual records and hashes](./round2/fifo-adaptive.json).

| Burners | Revision | n | Test elapsed p50 / p95 (s) | Commit→900th copy p50 / p95 (s) |
|---:|---|---:|---:|---:|
| 0 | main-fifo | 3 | 9.205 / 11.136 | 9.190 / 11.119 |
| 0 | adaptive | 3 | 9.013 / 9.580 | 8.996 / 9.568 |
| 20 | main-fifo | 3 | 9.036 / 10.337 | 9.006 / 10.315 |
| 20 | adaptive | 3 | 6.601 / 7.067 | 6.568 / 7.043 |
| 120 | main-fifo | 3 | 19.878 / 20.607 | 19.807 / 20.509 |
| 120 | adaptive | 3 | 13.579 / 13.641 | 13.473 / 13.530 |

Paired current-main versus final round-2 candidate. [Individual records and hashes](./round2/main-final.json).

| Burners | Revision | n | Test elapsed p50 / p95 (s) | Commit→900th copy p50 / p95 (s) |
|---:|---|---:|---:|---:|
| 0 | main | 5 | 6.574 / 8.108 | 6.559 / 8.086 |
| 0 | final | 5 | 0.241 / 10.829 | 0.229 / 10.819 |
| 20 | main | 5 | 9.010 / 11.298 | 8.983 / 11.269 |
| 20 | final | 5 | 6.402 / 6.696 | 6.370 / 6.663 |
| 120 | main | 5 | 23.286 / 25.060 | 23.215 / 24.920 |
| 120 | final | 5 | 12.767 / 16.147 | 12.662 / 16.055 |

Final paired slice decomposition, p50 per cell. The pause column counts nonzero repayment decisions; CPU and repayment are summed only until the 900th-copy commit.

| Burners | Revision | Delivery turns | Nonzero repayments | Charged CPU (ms) | Requested repayment (ms) |
|---:|---|---:|---:|---:|---:|
| 0 | main | 796.0 | 2337.0 | 832.8 | 5383.4 |
| 0 | final | 63.0 | 0.0 | 202.8 | 0.0 |
| 20 | main | 878.0 | 2633.0 | 825.8 | 5780.7 |
| 20 | final | 604.0 | 603.0 | 582.5 | 4077.0 |
| 120 | main | 896.0 | 2685.0 | 904.8 | 6333.5 |
| 120 | final | 607.0 | 606.0 | 613.5 | 4294.2 |

The current-main FIFO-only control does not remove the delay: there is only
one item, so selecting it without rotation still pays the repeated scan and
pacing costs. The adaptive-only ablation improves loaded completion without
changing CT pacing. The final combination reduces nonzero repayment decisions
from roughly three per delivery slice to one. These sequential shared-host
sweeps do not isolate a universal additional wall-time win for that second
change; the CPU-accounting tests and the retained counts establish its narrower
claim. No native cell exceeded the unchanged replay guard.


The final heavy-load commit-to-last-copy p95 is **24.920 → 16.055 seconds**
(35.6% lower), with all five trials per revision within the unchanged guard.
The no-burner cell remains a mixture of roughly 0.2-second unpaced runs and
seconds of contended pacing: final p95 is 10.819 seconds versus main 8.086,
so no universal no-burner improvement is claimed. The retained per-trial CPU
and requested pauses distinguish those modes.

### Read and timed-maintenance control

The unchanged CT mixed control runs for 125 seconds per revision with 120
external keeper-owned burners on CPUs 80–89. Its own `--levels 0` means it
adds no further workers; `busy: 0` in that tool's records must not be read as
an idle host. This control has no Following backlog. The separate replay and
browser fixtures qualify live delivery while this control checks the CPU
repayment change against reads and timed obligations.

Both runs exit 0. Main performs 29,700 reads at 13.017 ms p95; round 2 performs
31,476 reads at 12.613 ms p95. Each observes all six deliberately abandoned
leases, zero unexpected lease changes, exact 1,000 ms explicit lease extension,
all expected minute boundaries once, successful delivery/retry effects and the
expected deadline failure. Physical expiry is observed with maximum delay
1,064 / 1,086 ms, and abandoned-lease recovery with maximum delay 2,058 / 1,982 ms.
The latter timings vary within the ordinary periodic cadence; the report does
not claim that every maintenance metric became faster.
[Main summary](./round2/mixed-main-summary.json) and
[candidate summary](./round2/mixed-final-summary.json) retain outcomes;
[the initial thread audit](./round2/mixed-affinity.json) and
[the final mixed audit](./round2/final-mixed-affinity.json) check the inherited
CPU mask. The initial candidate's mixed records remain retained separately.

### Affected verification

The final affected runs pass 112 guide cases, 17 timeline background cases,
eight continuing-arrival fairness cases, six live-latency cases, eight CT
maintenance cases, all 22 replay cases and the unchanged upload test.
[Command results](./round2/final-affected-results.json),
[language output](./round2/final-affected-language.log),
[maintenance output](./round2/final-affected-maintenance.log),
[replay output](./round2/final-affected-replay.log), and
[upload output](./round2/final-affected-upload.log) retain the checks. The
uninstrumented 900-follower replay takes 215 ms in this affected run, with no
injected burners; that individual observation is not a loaded distribution.
The intentionally failing [old-scan control](./round2/negative.log) confirms
that the new bounded-lookahead regression detects the previous behavior.


### Published-client comparison

Both formal runs exit 0 with no page errors: 270 writes and 540 remote renders
per revision, using 30 writes per shape/load. The main control already includes
round 1; this comparison measures the round-2 change on the merged baseline.
[Main summary](./round2/web-main.summary.json),
[candidate summary](./round2/web-after.summary.json),
[main timestamps](./round2/web-main.stamps.csv) and
[candidate timestamps](./round2/web-after.stamps.csv) retain all cells.

Primary commit-to-render latency in milliseconds, slower receiver per write;
n=30 per cell, nearest-rank percentiles.

| Burners | Shape | Main p50 / p95 / max | Round 2 p50 / p95 / max |
|---:|---|---:|---:|
| 0 | repost | 179.9 / 925.8 / 1,507.8 | 208.6 / 605.3 / 650.5 |
| 0 | message | 70.1 / 275.6 / 333.3 | 89.9 / 289.3 / 309.3 |
| 0 | reaction | 37.5 / 62.9 / 66.8 | 32.7 / 40.6 / 49.8 |
| 20 | repost | 158.4 / 511.1 / 628.5 | 183.5 / 647.0 / 700.1 |
| 20 | message | 118.6 / 464.3 / 484.1 | 148.6 / 503.2 / 657.1 |
| 20 | reaction | 111.3 / 195.6 / 617.4 | 124.3 / 178.9 / 179.7 |
| 120 | repost | 456.9 / 2,254.3 / 3,894.7 | 429.2 / 1,352.9 / 1,426.8 |
| 120 | message | 384.6 / 1,117.5 / 2,021.3 | 436.2 / 1,276.3 / 1,517.5 |
| 120 | reaction | 423.4 / 693.8 / 826.7 | 543.4 / 746.2 / 840.5 |

Per-stage p95 in milliseconds from commit, pooling receivers (normally n=60).
These are overlapping intervals, not additive costs. Delivery means the fresh
event's final copy; message/reaction use the source commit. As in round 1, an
evaluation may use its own copy before the final other-receiver cut arrives.
Receipt and evaluation are channel-specific stamps, not a universal FIFO chain.

| Revision | Burners | Shape | Delivery | Published | Received | Evaluation | Render |
|---|---:|---|---:|---:|---:|---:|---:|
| Main | 0 | repost | 48.7 | 48.8 | 54.2 | 54.7 | 726.7 |
| Main | 0 | message | 0.0 | 0.1 | 21.9 | 24.4 | 237.4 |
| Main | 0 | reaction | 0.0 | 0.2 | 23.3 | 48.2 | 48.9 |
| Main | 20 | repost | 92.3 | 92.5 | 117.4 | 125.3 | 375.5 |
| Main | 20 | message | 0.0 | 0.1 | 77.5 | 91.5 | 279.5 |
| Main | 20 | reaction | 0.0 | 0.1 | 74.1 | 181.7 | 194.4 |
| Main | 120 | repost | 175.5 | 175.7 | 349.1 | 349.7 | 1,186.1 |
| Main | 120 | message | 0.0 | 0.1 | 229.4 | 259.5 | 863.1 |
| Main | 120 | reaction | 0.0 | 0.1 | 277.9 | 623.4 | 624.2 |
| Round 2 | 0 | repost | 65.8 | 66.0 | 72.1 | 45.9 | 383.0 |
| Round 2 | 0 | message | 0.0 | 0.1 | 17.0 | 18.9 | 229.1 |
| Round 2 | 0 | reaction | 0.0 | 0.1 | 17.6 | 39.1 | 39.7 |
| Round 2 | 20 | repost | 72.2 | 72.4 | 109.9 | 106.3 | 440.2 |
| Round 2 | 20 | message | 0.0 | 0.2 | 77.8 | 86.1 | 415.1 |
| Round 2 | 20 | reaction | 0.0 | 0.1 | 88.2 | 163.8 | 167.9 |
| Round 2 | 120 | repost | 128.1 | 128.3 | 383.2 | 383.2 | 953.4 |
| Round 2 | 120 | message | 0.0 | 0.1 | 296.8 | 308.5 | 832.5 |
| Round 2 | 120 | reaction | 0.0 | 0.1 | 337.8 | 700.2 | 707.4 |

Observed ten-CPU utilization and whole-host one-minute load, p50 / p95.

| Revision | Burners | Scoped busy % | Host load |
|---|---:|---:|---:|
| Main | 0 | 64.4 / 71.4 | 88.3 / 118.4 |
| Main | 20 | 99.8 / 100.0 | 61.8 / 67.3 |
| Main | 120 | 100.0 / 100.0 | 138.5 / 165.8 |
| Round 2 | 0 | 63.2 / 70.6 | 16.9 / 17.4 |
| Round 2 | 20 | 99.9 / 100.0 | 26.3 / 37.4 |
| Round 2 | 120 | 100.0 / 100.0 | 120.4 / 130.5 |

Main-stage receipt counts below 60: main 20:repost commitToReceived n=59; main 120:repost commitToReceived n=59; after 0:repost commitToReceived n=54; after 20:repost commitToReceived n=59; after 120:repost commitToReceived n=58.
Other channel counts remain in the summaries. Missing stamps are omitted,
never filled with zero. [The main/initial affinity audit](./round2/web-affinity.json) and
[final browser audit](./round2/final-web-affinity.json) cover all three load
levels through the inherited guard.

All heavy-load primary p95s remain below two seconds in this run: repost
1,352.9 ms, message 1,276.3 ms, reaction 746.2 ms. The small delivery still
overtakes history: heavy repost final-copy p95 is 128.1 ms (main 175.5 ms),
versus the many-second FIFO drain recorded in round 1. Its primary render p95
is 2,254.3 → 1,352.9 ms on this merged-main comparison. Background tenants and
whole-host load differ, so these are measured distributions, not a guaranteed
speedup for every update or an isolated estimate of each optimization.

Message shows **mixed results** in this comparison: heavy primary p95 rises from
1,117.5 to 1,276.3 ms, while maximum falls from 2,021.3 to 1,517.5 ms. At moderate load,
its p95 also rises, 464.3 → 503.2 ms. No message or observation policy changed;
the data do not support a universal message win. Reaction heavy-load p95 also rises, 693.8 → 746.2 ms.

The no-burner repost p95 is 605.3 ms (main 925.8 ms), still above the 500 ms
target. This shared-host condition is not globally idle. Its final-copy p95
is 65.8 ms, so the remaining tail is after delivery. The existing
[observation-publication follow-up](../../../issues/closed/20261003-snapback4-live-query-publication-starves-during-following-backfill.md)
remains open. No retention, authority, withdrawal or observation bound changed.

An independent [CSV validation](./round2/web-validation.json) reproduces every
primary p50/p95/max within 0.001 ms of rounding and verifies 270 paired writes
per revision. It also finds one raw ordering anomaly: final heavy message trial
27, Carol, renders at −9.626 ms relative to the post-commit stamp (its matching
HTTP evaluation is at −22.226 ms). Bob renders at +185.074 ms, which is the
primary sample for that write. The new row is `message-87`, sequence 20555;
the matcher checks exact row identity, not a prefix.

These probes stamp after `tx.commit()` returns and compare server wall time
with each browser's performance-origin clock. Post-commit descheduling and
cross-clock alignment can affect that comparison; the exact cause of this
sample is not established. The raw negative value is retained, with no offset,
clamping or sample removal. It prevents a claim of universal millisecond-level
stage ordering from these raw probes. The same-write slower-receiver sample
and all reported tail percentiles are unchanged by this fast-sample anomaly;
the separate suite regression checks its own stage ordering and generous bound.


### Final complete verification and retained artifacts

The corrected candidate's required full eb1000 suite exits **0**, with
`== 0 failure(s) in 1505 s`. It runs as:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT CARGO_BUILD_JOBS=16 \
LU_TEST_CPUS=90-91 taskset -c 0-31,48-79 bash snapback4/scripts/test.sh
```

Every Rust target and doctest passes, including the complete CLI unit target
(284 passed, four ignored), all replay cases and the unchanged upload test.
The 311 client files pass 6,187 tests with 11 skips, the two model files pass
79/79, and fixture wrappers pass 9/9. Every build, typecheck, release guard and
docs/wasm budget step passes. No suite timeout, count or ownership check changes.
[Result](./round2/final-full-suite-result.json) and
[compact output](./round2/final-full-suite-summary.log) retain the final run;
the first suite's witness failure remains recorded above and in its open ticket.

The locked Linux wasm build measures **2,116,457 B raw / 639,750 B gzip** by
the canonical `build-wasm.sh` gzip command. The unchanged 639,887 B cap leaves
137 B: the recorded 130 B macOS allowance plus 7 B. No Mac build is claimed.
The final build is byte-identical to the frozen browser SDK's wasm.
[Wasm record](./round2/wasm.json) and
[final source/binary/SDK hashes](./round2/final-production-artifacts.json)
retain custody. The incoming main contains other lanes' wasm changes, so the
older round-1 wasm value is not an isolated round-2 baseline.

[The artifact manifest](./round2/ARTIFACTS.json) hashes native probes, both
suite logs, browser event streams, mixed-control records, sources and tools.
Large raw streams, binaries and databases stay under ignored `target/lu-r2*`.
Every new retained evidence file is below 256 KB; no gzip or movie is included.
The formal experiment processes exited normally and their keepers reaped the
owned burners. The
CPU-debt correction is included in the final measured source hashes. The
reference audit passes: 527 LLP documents, 10,342 references, 34,414 files,
zero errors and zero unchecked references. Source/tool hashes match the
measured artifacts, original replay/upload tests and the budget are unchanged,
and no instrumentation remains in shipping sources. Whitespace checks pass.
Nothing is pushed, and no other machine was used.


## Round 3 — preserve repayment in either worker ordering

2026-10-04, eb1000 only, based on `b0e17cec74` (round 2, landed as
`ce9bef594a`). Astra's P2 is reproduced deterministically: with 70 ms scheduled,
10 ms elapsed and another 70 ms charge, the old completion path retains only
70 ms instead of 130 ms. `completed()` now uses
`resume_at = max(resume_at, now) + pause`, matching `empty_cycle()`. Both worker
orderings conserve outstanding repayment, including an empty completion that
adds no immediate pause. Per-kind charges, sleep caps, aged opportunities and
Following's frozen-P service bound are unchanged. LLP 3000 §7 now states both
orderings explicitly.

The new regression fails against round 2 with `left: 70ms, right: 130ms` and
passes with the fix. It checks useful and empty completions and the exact
repayment deadline without sleeping. The reverse-order regression and the
240 ms (100 + 100 + 40) case remain. Existing clock fixtures now start at the
state's own initial instant, avoiding microsecond differences from separately
sampling the real clock.

### Brief confined replay comparison

The same instrumented 900-follower fixture and unchanged 60 s guard run three
times per revision, alternating order, with 120 keeper-owned burners on CPUs
80–89. The inherited affinity guard and [thread audit](./round3/affinity.json)
confine all 124 observed processes / 134 threads to those ten CPUs. The keeper
stops and reaps only its own burners. Host one-minute load at trial completion
ranges from 63.2 to 117.6. Ordinary verification runs outside these CPUs.

| Revision | Commit → 900th copy, trial order (s) | Median (s) | Maximum (s) | Delivery turns through last copy |
|---|---|---:|---:|---|
| Round 2 | 15.974, 12.820, 13.128 | 13.128 | 15.974 | 644, 597, 634 |
| Round 3 | 11.742, 13.267, 13.289 | 13.267 | 13.289 | 603, 610, 611 |

All six trials pass. Each has one fewer nonzero repayment decision than delivery
turns through the last copy; round 2's combined repayment and bounded scan gains
remain. This small sample shows comparable completion, not a new latency win or
a precise tail estimate. The earlier 16.055 s nearest-rank p95 was the maximum
of that run's five samples, not a reproducible host-independent percentile.
The earlier message and reaction heavy p95s rose slightly while remaining below
2 s. The n=30 comparison remains round-2 evidence; browser regression coverage
in round 3 comes from the full suite.
[Per-trial stamps, counts and raw-log hashes](./round3/replay.csv) retain this
comparison. The existing replay builder now accepts both deadline assignments
and injects the same probes. Raw logs and binaries remain ignored under
`target/lu-r2/` and `target/lu-r3/`; no large artifacts are added to git.

### Verification

Affected Rust checks pass: nine maintenance tests (including aged and expiry
cases), 17 timeline background tests, eight fairness tests, six live-latency
tests and all 22 replay tests. The full `bash snapback4/scripts/test.sh` run
exits 0 in **1,957 s**: all Rust targets/doctests; CLI 285 passed/four ignored;
clients 6,187 passed/11 skipped, including the confined Chromium regression;
models 79/79 and fixtures 9/9; all build/typecheck/budget steps pass.
[Commands, results, build inputs and hashes](./round3/verification.json) retain
the evidence. The new regression's round-2 negative control exits 101 as expected.

The suite uses `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`,
`CARGO_INCREMENTAL=0`, and `CARGO_PROFILE_DEV_DEBUG=0` /
`CARGO_PROFILE_TEST_DEBUG=0` after the old build cache was cleared. Optimization
and debug assertions retain their checked-in settings. Sampled worktree disk
use stays below **14.1 GB**, within the 40 GB limit. Wasm remains 2,116,457 B raw /
639,750 B gzip under the unchanged 639,887 B cap, preserving the 130 B macOS
allowance. `ref-check --verbose` and whitespace checks pass. Nothing pushed.
