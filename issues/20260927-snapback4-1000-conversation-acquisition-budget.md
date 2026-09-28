# Snapback 4: 1,000-conversation acquisition and publication pause exceed targets

Status: Open
Date: 2026-09-27
Owner: Snapback 4 performance lane

Lane SS round 2 reduces the calibration #23 synthetic extension's cold
acquisition from 21.854 to 16.324 s with memory persistence, and from 41.477
to 21.036 s with fake-indexeddb. Both still exceed the 8/12 s targets.
There are 110,088 received rows, about 42 MB JSON and 13 responses after
the change, versus 30 before. The final normal wasm fits the unchanged
572,841-byte gzip budget at 572,590 bytes.

Real Chromium/IndexedDB improves from 84.898 to 27.327 s at 1,000
conversations. The final during-acquisition live p95 is 13.158 s (19 samples,
zero timeouts); after-acquisition p95 is 0.754 s (20 samples). At 100,
acquisition is 4.186 s but during p95 is 2.449 s (five samples). The inherited
one-second during-acquisition target is unresolved. The baseline 1,000 run
had one >31 s timeout among 40 during samples; its low p95 hid that tail.

The profile locates remaining cost in terminal row/index publication, then
strict persistence. Chromium terminal apply is 7.012 s and its save 5.197 s.
The wasm call remains synchronous on the watch's thread. Larger bounded
pages, namespace-grouped indexes, one replacement index undo image, shared
row-image construction, sparse empty-media markers and cached bucket byte
sizes are already included. Sorted bulk indexes and alternative comparisons
did not achieve the targets within the unchanged wasm budget.

Evidence, full per-phase before/after tables, raw timed pages, sampled CPU
categories, physical transactions/puts/bytes, tool commands and memory
limits: [round-2 report](../snapback4/reports/20260927-ss-sync-scale/ROUND2.md)
and [measurements](../snapback4/reports/20260927-ss-sync-scale/round2-measurements.json).

Reproduce from `snapback4/` after the normal wasm/package builds, serving
only a private `scale1000` fixture with `snapback4 dev --replay --no-watch`
on 49372:

```sh
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49372 target/memory.json memory
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49372 target/idb.json idb
node witness/sync-scale-browser.mjs http://127.0.0.1:49372 target/browser.json
```

Keep atomic publication, durable staged restart, authorization, expiry,
meters and the wasm budget. A lower sample p95 caused only by collecting
more successful sends before one stalled publication is not closure.
Resolve with repeatable acquisition evidence meeting 8/12 s and the live
target, or an explicit author-approved disposition of the remaining limits.

## Round 3, 2026-09-27

Still open. Two repetitions after removing index-value/key copies acquire
1,000 conversations in 15.689/15.998 s memory and 21.132/21.108 s IDB-shaped.
Browser terminal apply falls from 7.098/7.129 s to 6.730/6.603 s, but its
strict terminal save rises from 5.107/4.601 s to 6.567/6.010 s. Browser total
28.445/27.749 s and during p95 14.393/13.680 s do not improve the target.
All four normal browser runs have 19 during samples and no timeouts.
Observed wasm/external high-water memory also increases and remains reported.
Final wasm 572,786 B gzip fits the same budget by 55 B.

A bulk-index prototype gives a 13.635 s memory trial but exceeds the wasm
budget by 1,121 B and is removed. Browser instrumentation measures the
synchronous wasm pause separately from JSON during saves and IDB request
issuance. A Worker is the proposed execution location, but journal capture,
exit-send fencing and server-read prediction checks must retain authority
without queuing behind that Worker. A simple asynchronous call proxy is
insufficient. The requested plan, experiments, both repetitions, mutation
controls and qualification are in [ROUND3](../snapback4/reports/20260927-ss-sync-scale/ROUND3.md),
including its [Worker follow-up](../snapback4/reports/20260927-ss-sync-scale/ROUND3.md#worker-decision-and-bounded-follow-up).
No Worker or changed acquisition protocol is shipped in this round.

## Round 4, 2026-09-28 — internal Worker subset

Still open. The lane implements an internal page-owned Worker dispatcher and
strict wasm/IndexedDB runtime, with page-local journal capture and shared
synchronous/asynchronous execution plans. Chromium's 26-case protocol witness
covers interruption before/inside/after admission commit, staged/terminal save,
navigation, claim retention, original record recovery, cleanup failure and
full offline shell/Worker/wasm reopen. It does not run the scale workload.

`webDevice({ worker: true })` remains unimplemented. The page control snapshot,
server-read bypass, prepared suspension transport, orphan/receipt integration,
conditional delivery collection and mixed-opener lifetime coordination still
need implementation/qualification. No 100/1,000 acquisition or live p95 number
was measured this round; all four new browser targets are unestablished.
The ordinary default remains in place. Round 3's unlanded index copy reductions
were removed before this work. See [ROUND4](../snapback4/reports/20260927-ss-sync-scale/ROUND4.md)
for the exact implemented subset, tests and remaining acceptance.

## Round 5, 2026-09-28 — Worker option measured, acquisition still over target

Still open. The local lane now implements `webDevice({ worker: true })`,
the conservative page control snapshot/cold-watch bypass, prepared suspension,
orphan/shared-receipt recovery, conditional delivery commit checks, mixed
default/Worker navigation and bundled offline reopen. The unchanged default
path remains the default. No code is pushed or published by this lane.

Two final quiet-host Chromium runs with the live writer at 1,000 conversations
measure 28.945/30.259 s acquisition, 516/515 ms during-acquisition live p95 and
55/53 ms longest main-thread task. The page responsiveness and live p95 targets
pass at 1,000, but the 27 s acquisition target fails. During maxima are
1,426/1,312 ms over 101/102 samples, with zero timeouts; subsecond p95 does not
mean every message met one second. Ordinary controls acquire in 27.066/26.876 s,
with live p95 12.517/12.719 s and main-thread pauses 6.946/6.892 s.

At 100, Worker acquisition is 5.291/4.997 s against ordinary 4.216/4.216 s;
its live p95 is 1.686/1.019 s. Those regressions remain explicit acceptance
misses. No sync-card Worker recommendation was added. The historical Node
8/12 s targets are not remeasured or closed. Total Worker memory is not
established by the page-only heap numbers. Wasm remains byte-identical at
2,019,815 B raw / 585,384 B canonical gzip, cap unchanged at 586,193 B.

See [ROUND5](../snapback4/reports/20260927-ss-sync-scale/ROUND5.md) for both
initial/final Worker repetitions, controls, raw evidence, protocol tests,
remaining acquisition work and outstanding independent review. Nothing in
this round is ready for landing while those acceptance conditions remain.


## Round 6, 2026-09-28 — real Clique accounts

Still open for the historical Node/live-writer goals and independent review.
The real calibration-24 store has 1,000 memberships for u0001 and 100 for
u0500; the copied builder Metro export acquires 110,000/15,679 events.
Two final Worker runs, fresh navigation through UI login and readiness:
27.391/28.804 s centrally, 4.166/4.046 s at 100. Acquisition has no Long Tasks
entry; including boot the worst is 77 ms. The round-6 30 s / 5 s / 200 ms
targets pass for this workload. The unchanged default still blocks about
7.5 s centrally. This does not close the different synthetic live-writer
or Node 8/12 s acceptance conditions from earlier rounds.

Bounded, transaction-local proof now coalesces a completely deleted physical
row namespace into one IDB range delete. Pure bucket deletion skips encoding
removed images for capacity calculations. Rows, staging, watermark and outbox
keep one strict commit, the existing format and caps, and abort/reopen tests.
Matched Metro Worker terminal saves fall from 3.742/3.986 s to 2.757/3.361 s;
total acquisition is roughly unchanged within observed variation. Bucket
write volume remains substantial: 636.9 MB of serialized put records in the
instrumented central run. A sorted bulk-index trial exceeds the unchanged
wasm budget by 909 B and is discarded; final shipping wasm is byte-identical.

The supplied 90-second timeout is not reproduced on this Linux host, including
with the published 0.4.6 Linux server/client (29.089 s from login submit).
The original record identifies Darwin/arm64; no claim is made to fix that
unreproduced cause. The two public maintained interaction views add 6,012
rows, already warned by N_MAINTAIN_SYNCED. The sync card now explains how to
bound and measure the largest account without hiding offline tradeoffs.

See [ROUND6](../snapback4/reports/20260927-ss-sync-scale/ROUND6.md) for per-table
bytes/responses, phase timings, rejected candidates, exact qualification and
commands using only private copies. Nothing was pushed, published or landed;
Worker review and broader memory/platform qualification remain outstanding.
