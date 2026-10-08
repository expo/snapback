# FT — remaining client flakes, 2026-10-08

Worktree: `sb4-intent/ft-client-flakes`, starting at `ecba83f39e` on eb1000
(`expose-builder-pixel`). No remote execution, publication or push.

## Scope and governing context

Read the Snapback 4 fence, LLP 3000, LLP 2000.000, NOT-DOING, adopted
rules, journal tail and all nine commissioned tickets. Applied `llp-orient`:
LLP 3000 §Publication suite under contention requires state barriers without
weaker outcomes or incidental throughput assertions; LLP 3000.023 §10 governs
remembered answers and invalidation, and §11 governs one-shot settlement and
prompt offline refusals. Both governing LLPs are linked in `llp/current/`; neither is linked in
`llp/foundation/`. §11's SN implementation is present at the starting commit. No new design is proposed.

The original tickets can outlive a fix or be duplicated by a merge. A passing
isolated run alone does not close an unexplained failure. Changes here must
preserve custody, freshness, injection, recovery and emission assertions.

## Setup and load

`bun install --frozen-lockfile` passed in the repository and Snapback 4
workspaces. The first SDK dependency check was invoked from the repository
root and failed because it expects the Snapback 4 workspace; rerunning there
printed `deps-ok`. Native, locked wasm and SDK artifacts were built in this
worktree. Native build used eight jobs, no incremental/debug information and
`LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Wasm measured
2,135,891 B raw / 645,680 B gzip, within the unchanged 646,180 B budget.

The campaign uses the ordinary `runFile` keeper and native Node test isolation.
Eight client files and eight shell busy loops inherit `taskset -c 64-71`.
Each file starts fresh fixtures, ports and browser contexts. All loop handles
are retained and reaped; the ordinary runner checks each test process group.
No process in another lane is signalled. Node 24.13.1, Bun 1.3.14.

Raw evidence lives in `target/ft-client-flakes/`; the completed results and
retained evidence archive are recorded below.

## Result by ticket

Five tickets close; four remain open with evidence. No product source changed.
All outcome assertions, tests, seeds and hang guards remain; W5R2a now adds a
receipt/event agreement assertion. Nothing was pushed.

| Ticket | Reproduction / current evidence | Disposition |
| --- | --- | --- |
| Session restore, Sep 23 | Existing `9473e0a347` repair; full local-e2e file 30/30, 150 tests. Immediate-revocation control fails with the original signature. | Closed; duplicate incident of the Sep 27 resolved ticket. |
| Parallel fixture ECONNRESET, Sep 27 | All three full files 30/30 each: app-global 210, server-clock-wire 300, store-reset-reconnect 360 passing tests. No reset. | Open; no identified cause for those direct global-fetch calls. |
| React journal invalidation, Sep 27 | Existing FX product fix `61b75b5387`; full React file 30/30, 2,100 tests. Removing its storage listener fails the named admission case again. | Closed; remove resurrected open copy and retain the existing detailed closed record. |
| Server-watch offline freshness, Sep 27 | Original freshness predicate passes in all 55 diagnostic/baseline runs, including seven failures at the later recreated-watch predicate. Final residency 30/30. | Open for its distinct historical signature. |
| Browser close stalls, Sep 29 | Typing, session-authority and web-start full files 30/30 each (60, 570, 540 tests). Repaired admission file passes 55/55; focused browser cohort 30/30, 300 tests. No close stall. | Open; Linux evidence does not resolve the original four Darwin stalls. |
| W5R2a first mutate, Sep 29 | Prior explicit-wait repair passes; default four-second wait fails with a six-second reply delay. Final zero-wait admission plus terminal-event/receipt barrier passes 30/30 on **each** of wasm and process (60 tests). | Fixed and closed. |
| Follow fault injection, Oct 1 | Existing `69140d7ca7` ownership barrier survived, but its private sync hooks were stale after SN. Updated matrix passes 339/339; current follow sites 48/49 pass 30/30, 330 tests. Drain-removal control reproduces zero injections. | Repaired and closed. |
| Mixed-evidence wasm timeout, Oct 1 | Five complete runs, each 300 process + 300 wasm histories and three schedules/history: **1,500 histories per host**. All pass, no skips. | Open; original stalled operation remains unidentified. |
| Recreated offline watch, Oct 7 | Original 1/5 failures; instrumented originals another 6/50. Snapshot is loading, not wrong freshness. Final full residency file 30/30, 300 tests; forced late apply distinguishes old/new ordering. | Fixed and closed. |

The 30 full-file counts for unchanged files combine the five baseline and
25 confirmation runs; their source bytes did not change. Final residency also
passes one additional complete 10-test run after formatting. The final
acquisition file passes **47/47**, and the full browser admission plus full
matrix rerun passes **394/394**. Adjacent offline-refusal cases, corrected to
SN's contract, pass 30 focused repetitions (11 cases each). No browser skip
was used to obtain these results.

## Causes and changes

**Residency: displayed data preceded recoverable memory.** The failing trace
records the server answer before an in-flight sync publication. In diagnostic
run 15, `/q/audits` completes at 1752.4 ms; watermark 2 publishes at 1762.9 ms;
the fixture goes offline by 1773.7 ms. `LocalReads.committed/applied` correctly
clear remembered server answers on publication (LLP 3000.023 §10). The mounted
watch can retain its displayed `a2`, but a new watch then has no offline memory.
The first row-only predicate was insufficient as a disconnection precondition.

The test still first proves the online-only commit reruns the watch. It then
awaits an explicit sync and `a2` with `fresh === true` and no `revalidating`,
before disconnecting. It retains every original offline, `since`, local-first,
recreated and reconnect assertion. Failure diagnostics capture the current
snapshot/link and a bounded transport/device trace. There is no product fix.

The deterministic control holds the watermark-2 apply while the server query
shows `a2`, releases apply and immediately continues. With the new barrier,
the test passes; removing it times out at the original recreated-watch wait.
An earlier exploratory extra empty-sync control passed both stages; it did not
force the relevant seed publication and is not counted as a detecting control.
The older freshness-downgrade ticket stays open because none of these failures
has that signature.

**W5R2a: wait for terminal delivery and custody.** The previous explicit
25-second waits removed the default four-second assumption but still depended
on response scheduling. Both mutations now admit with `waitSeconds: 0`; the
test waits for the ID's terminal `onWrite` event and checks its durable receipt
agrees. It then executes the same sent/queued, 256-emission eviction, pinned
receipt, exactly-once and eventual collection checks. The existing state-wait
hang guard and work-counted parent guard are unchanged.

An intermediate receipt-only candidate was wrong: persistence precedes terminal
notification. It failed the second-ID `0 !== 1` emission assertion in all
30 two-host runs (60 failed tests). Waiting for the event as well corrects this
new observation race. Those failed runs remain in the evidence and are not
included in final passes. The final 30 two-host runs pass 60/60.

**SN integration drift in the affected neighbours.** Acquisition's eleven
provisional-refusal variants expected `E_QUERY_RETRY` while deliberately
offline. LLP 3000.023 §11 now requires prompt `E_OFFLINE` for dependent custody
on a known offline link. Only that exact refusal expectation changes; the
prediction, queued-write and eventual ordinal assertions remain.

Browser admission's observation hook now wraps `network.once` at its attempt
boundary, retaining arguments, returned promise identity and scheduling. It
still sees attempts that join existing syncs, not only new `syncRound` work.
The matrix exposes `network.current` and `network.once` through its existing
private hooks, updates semantic follow/flush await IDs, and pins the current
complete boundary record. All **162** delivery I/O recipes/classifications
remain. Site 48 is the current follow-sync await; 49 is its retry wait. The old
numeric selector 47 now names another follow await, so current proof selects
the semantic sites, not the ticket's stale ordinal.

Boundary audit: six existing classified expressions changed through network
coordination and dispatch-store propagation; none lost its recipe. The new
LocalNetwork await joins an active round before reservation; joined-follow
controls retain rejection and transport-false coverage. Query custody,
dependencies, settlement and Following waits observe existing custody/read
state, with no new write-dispatch or settlement I/O. Session-refusal is
synchronous. The instrumenter records this audit beside the refreshed seal.

## Controls and full-count oracle evidence

| Control | Result |
| --- | --- |
| Session restore: restore immediate server assertion while retaining 300 ms logout delay | Expected failure: `undefined` versus `E_AUTH`. |
| React: remove only product storage-event registration in a disposable Vite transform | Named admission invalidation times out at 122 s; two other storage cases and parent also fail (66 pass / 4 fail). |
| Follow: remove shared-work drain, retain competing operation and all assertions | Expected original failure: `the classified await must actually experience an injected fault`. |
| Follow: disable fault injection, retain reachability/recovery assertions | Two injection assertions fail; classification and joined-follow controls pass. |
| Residency: held seed apply, final barrier present | Complete file 10/10. |
| Residency: identical held seed apply, remove only new barrier | 9 pass / 1 expected recreated-watch timeout; snapshot loading. |
| W5R2a: two-second response delay | Both prior explicit and default waits pass; this is a non-detecting trial because default is four seconds. |
| W5R2a: six-second response delay, original default wait | Expected `pending` versus `sent` failure. |
| W5R2a: same six-second delay, final state barrier | Pass. |
| W5R2a: suppress terminal event delivery while leaving persistence alone | Expected `TEST_HANG: terminal emission` refusal at the unchanged state guard. |

All five default mixed-oracle runs retain 300 seeds per host, with no exception
or reduction. Process-host durations: 335.651, 341.930, 363.749, 481.739,
594.937 seconds. Wasm durations: 211.230, 227.373, 235.064, 223.182,
221.179 seconds. Whole-file times are 552.3–818.7 seconds. These are loaded
Linux observations, not Darwin qualification or a timing baseline. Neither
finite one-shot settlement nor generic process cleanup proves every oracle
barrier can make progress; the ticket remains open.

## Reproduction and retained evidence

Run from `snapback4/` after the native/wasm/SDK builds above:

```sh
taskset -c 64-71 node reports/20261008-ft-client-flakes/campaign.mjs replay 30 residency,delivery-fault-matrix
FT_FOCUS=receipts taskset -c 64-71 node reports/20261008-ft-client-flakes/campaign.mjs receipt-replay 30 acquisition
FT_FOCUS=1 taskset -c 64-71 node reports/20261008-ft-client-flakes/campaign.mjs consumer-replay 30 acquisition,web-admission-review
taskset -c 64-71 node reports/20261008-ft-client-flakes/controls.mjs
taskset -c 64-71 node reports/20261008-ft-client-flakes/state-controls.mjs
```

Control commands deliberately produce failing test results and save them; their
outer scripts are evidence drivers, not pass/fail gates. Use a fresh campaign
label. The ordinary file runner judges Node exit status and acknowledges group
cleanup even for expected failures. Campaigns overlapped within this worktree;
all use the same eight CPU affinity reservation and eight busy loops each.
Consequently fixed runs also include extra owned contention. Timings do not
form a matched throughput experiment. Each campaign's `load.json` records its
PIDs/files/slots; `load-reaped.json` confirms all eight loops were reaped.
Across the nine campaigns, all **72** load loops were reaped. No file reported
a cleanup/inspection error; every recorded keeper acknowledged release.

[results.json](results.json) records per-file counts, durations and custody
for every campaign, including all baseline/intermediate reds.
[evidence.tar.gz](evidence.tar.gz) retains raw logs, original/final input hashes, load records,
control sources, setup logs and detailed runner results under
`ft-client-flakes/`. The final product-source hash comparison has **zero changed
product files**. Disposable test copies have been removed from the workspace.
Archive SHA-256: `c359ae0f38f816873c2b939202493cb3364cc6539c7bd90ce817bc43a2298a41`.

The final SDK dependency check prints `deps-ok`; `./ref-check` passes with
zero errors. Affected-scope LLP audit: the changes follow existing §§10–11
rather than changing client semantics. The new residency reference resolves;
no governing LLP needs a design revision. The journal and ticket records land
with these tests. Four unresolved signatures remain explicitly open; no
complete release dry run or Darwin result is claimed.
