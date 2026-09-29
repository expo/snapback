# Lane PQ — per-row query work

Base: `ee514de117825183731eb0c215463f99c4775fe4`, branch
`sb4-intent/pq-per-row-hooks`. First command was `git fetch origin && git merge
origin/main`; already up to date. No push or publication.

## Result

1,000 distinct mounted queries now share a bounded evaluation queue: at most
**eight observation starts per event-loop turn and eight in flight**. Known
empty or unrelated replica applies do **zero** query evaluations. A controlled
relevant write does **1,000** evaluations, and 1,000 identical subscribers attach
to one observation. A list with the same 1,000 row fields takes **one** evaluation.
The client card shows both idioms and recommends the list when its fields can
be answered together.

The original online point fixture at N=1,000 sent **139,711 HTTP requests** for
one relevant write and took **98,405 ms** to settle; its page fixture exceeded
the 120-second write-visibility deadline. The final point/page runs use **1,000**
requests, at most eight outstanding, and have no observed browser task at least
50 ms. HTTP attempt counts include refused/retried requests, not just accepted
interpreter evaluations. This reproduces the overload shape; it is not a rerun
of the comparative's complete M3 choreography or scorer.

The copied three-hook ChatRail also exposed a clock/refetch feedback loop after
the first queue change. Clock samples previously re-evaluated every watch even
with no deadline. The final sweep re-arms future deadlines and evaluates only
due owners, after synchronously withdrawing all expired raw and held answers.
Sequential N=100, 500 and 1,000 cells now finish on every tier. A 1,000-row
ChatRail still costs 5.7 s to mount on wasm, 27.2 s on Worker and 7.7 s online;
this is bounded progress, **not a claim that thousands of joined row hooks are
cheap in wall time**. The list idiom remains the important throughput choice.

## Changes and authority

- `ReadWork` is per client and coalesces queued requests by observation. Its
  first batch uses a microtask; excess work yields through a timer. Running
  watches keep their existing dirty, revision, credential and publication checks.
  Closing cancels queued work. Rejected work releases its slot.
- Reload/withdrawal notifications remain synchronous. Expiry, evaluated denials,
  dependency evidence and lifecycle resets still withdraw before any callback can
  inspect protected peers. A source audit retained the original terminal/input
  guards before scheduling as well as at execution.
- Warm apply drains the affected dependency buckets after installing the sync
  watermark. This avoids evaluating both at apply and again at sync completion.
  Cold acquisition keeps progressive per-page evaluation. Empty touched sets no
  longer select every known observation; unknown dependencies stay conservative.
- Clock-offset corrections re-arm future deadlines without evaluating non-due
  owners. Current and independently held deadlines are still all checked, all
  due answers withdraw before callbacks, and each due owner queues once. Clock
  rollback cannot resurrect withdrawn answers. No dynamic clock index is added.
- Existing sharing now canonicalizes object argument keys through LV's authority
  key. The three retention policies remain separate. No cross-client cache,
  authorization change, row-key independence, retention relaxation, contract
  change, Rust change, meter change or budget increase.

Orientation used `llp-orient` and the client/read cards, LLP 3000.029 §§3–8
(retention and evidence fences), LLP 3000.016 §2.2 (atomic publication),
LLP 3000.019 §3.3 (deadline custody) and LLP 3000.023 (read ownership). The change
is recorded in LLP 3000.029 §13. No app-authoring compatibility surface changed.

Direct `client.query` and timed presence probes retain their own execution paths.
The queue bounds observation starts, not every internal retry or interpreter step.
LV's table footprint still means that changing one row can re-evaluate all N
queries on that table. This lane does not introduce finer read-set certificates.

## Fixture and measurement

`witness/per-row.q`, `per-row-workload.mjs`, `per-row-browser.tsx` and
`per-row.mjs` mount N=100, 500, 1,000 point reads, two-row bounded pages, duplicate
reads and a list. The real Rust backend holds 1,000 authorized owner rows. Browser
measurements mount actual React `useQuery` hooks on wasm/IndexedDB, Worker/IndexedDB
and online clients; process measurements exercise the same `client.observe` path
without React/DOM. Acquisition, initial connection and schema warmup precede mount.
No calls, authority or interpreter are stubbed in the performance fixture.

Mount is subscription/render start to all requested ready snapshots. Write timing
in JSON includes HTTP, explicit device sync, visibility and a **200 ms settlement
wait**; it is not pure query latency. Counts include background change delivery.
Idle is a one-second quiet sample: browser CDP TaskDuration, Node process.cpuUsage,
plus renderer/Worker aggregate or device-process CPU where available. The
main/host CPU columns overlap for browsers and must not be added. It is not a
long-run CPU average. Browser long-task entries cover mount and writes and only
report tasks >=50 ms; `<50` means none observed, not zero work. Process has no DOM
Long Tasks API; its 5 ms heartbeat reports maximum event-loop lag, a proxy, not
an exact task duration. Memory is an end-of-cell JS heap sample without forced GC;
The table also shows renderer RSS (Worker included) or Node plus device-process RSS.
Allocations from earlier cells and GC affect those samples; no retained-memory
regression claim is made. These are descriptive single samples on a shared host,
not wall-time gates. Counts are separately pinned by deterministic tests.

Host: Linux 6.8.0-138-generic x86_64; Node 24.13.1; Bun 1.3.14;
Rust 1.97.0 (2d8144b78); wasm-bindgen 0.2.127; no wasm-opt. Tools were already
available. The repository's pinned LLP submodule was initialized inside this
worktree to read `llp-orient`; no shared-path tool installation occurred.

Commands from `snapback4/`:

```sh
PQ_BASELINE=1 PQ_TIERS=wasm,worker,online node witness/per-row.mjs baseline.jsonl
PQ_TIERS=wasm,worker,online node witness/per-row.mjs qualified-browser.jsonl
PQ_TIERS=process node witness/per-row.mjs qualified-process.jsonl
PQ_CHAT=1 PQ_SHAPES=chat node witness/per-row.mjs qualified-chat.jsonl
```

`PQ_BASELINE` bundles the five changed baseline implementation modules from the named base commit
(`1` selects ee514de117825183731eb0c215463f99c4775fe4); it does not change the checked-out SDK. Original
process baseline measurements precede production edits and are the successful
process cells in `baseline.jsonl`. `baseline-browser.jsonl` is the corrected
browser baseline. Earlier harness failures in `baseline.jsonl` are preserved.
The baseline browser record was captured before the clock edit; the runner now
also restores its original expiry module. The original list baseline always returned 1,000 rows; compare baseline/final
list timings only at N=1,000. Final lists filter to their requested N.

## Final point and page measurements

Raw final records: [browser](qualified-browser.jsonl), [process](qualified-process.jsonl),
[copied ChatRail](qualified-chat.jsonl). Relevant/unrelated columns count device
queries plus HTTP attempts, including retries. Each final simple local cell uses
only device queries for the relevant write. Every idle cell performs zero query
evaluations. CPU is milliseconds in a one-second sample; memory is MiB.
`<50` means no entry in the browser Long Tasks API, not an exact maximum of zero.
The `final-*` and `measured-*` records are intermediate measurements superseded by
these `qualified-*` records; all are retained for investigation history.

| Tier | Shape | N | Mount ms | Relevant evaluations | Unrelated | Idle CPU ms (main / host) | Longest task ms / lag proxy | Heap / RSS MiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| wasm | point | 100 | 87.6 | 100 | 0 | 3.9 / 10.0 | <50 | 8.1 / 345.8 |
| wasm | page | 100 | 68.5 | 100 | 0 | 4.2 / 10.0 | <50 | 100.7 / 419.5 |
| wasm | point | 500 | 306.9 | 500 | 0 | 27.6 / 50.0 | <50 | 24.3 / 424.2 |
| wasm | page | 500 | 291.1 | 500 | 0 | 23.4 / 20.0 | <50 | 24.0 / 400.6 |
| wasm | point | 1000 | 593.2 | 1000 | 0 | 4.6 / 0.0 | <50 | 25.7 / 454.7 |
| wasm | page | 1000 | 595.4 | 1000 | 0 | 4.0 / 10.0 | <50 | 25.4 / 434.7 |
| worker | point | 100 | 154.1 | 100 | 0 | 2.6 / 10.0 | <50 | 112.9 / 652.0 |
| worker | page | 100 | 131.8 | 100 | 0 | 3.1 / 0.0 | <50 | 81.8 / 653.0 |
| worker | point | 500 | 486.5 | 500 | 0 | 3.2 / 10.0 | <50 | 96.4 / 673.0 |
| worker | page | 500 | 365.1 | 500 | 0 | 3.2 / 20.0 | <50 | 102.7 / 717.5 |
| worker | point | 1000 | 1157.8 | 1000 | 0 | 3.2 / 20.0 | <50 | 14.6 / 468.0 |
| worker | page | 1000 | 780.5 | 1000 | 0 | 2.8 / 20.0 | <50 | 19.3 / 554.8 |
| online | point | 100 | 124.9 | 100 | 0 | 2.6 / 20.0 | <50 | 21.1 / 524.3 |
| online | page | 100 | 108.7 | 100 | 0 | 3.1 / 10.0 | <50 | 28.5 / 528.5 |
| online | point | 500 | 398.0 | 500 | 0 | 3.3 / 30.0 | <50 | 44.4 / 474.6 |
| online | page | 500 | 400.7 | 500 | 0 | 3.2 / 10.0 | <50 | 7.5 / 464.7 |
| online | point | 1000 | 945.8 | 1000 | 0 | 2.7 / 0.0 | <50 | 9.6 / 460.3 |
| online | page | 1000 | 838.7 | 1000 | 0 | 2.2 / 10.0 | <50 | 29.5 / 486.9 |
| process | point | 100 | 46.8 | 100 | 0 | 56.5 / 0.0 | 6.6 lag | 15.4 / 99.1 |
| process | page | 100 | 33.4 | 100 | 0 | 13.7 / 10.0 | 1.2 lag | 16.0 / 105.4 |
| process | point | 500 | 130.9 | 500 | 0 | 10.7 / 0.0 | 13.1 lag | 22.2 / 121.3 |
| process | page | 500 | 87.9 | 500 | 0 | 9.7 / 0.0 | 4.9 lag | 29.3 / 126.9 |
| process | point | 1000 | 247.5 | 1000 | 0 | 11.7 / 0.0 | 23.3 lag | 30.0 / 154.2 |
| process | page | 1000 | 248.8 | 1000 | 0 | 6.8 / 0.0 | 10.2 lag | 73.8 / 178.1 |

## List and duplicate idioms at N=1,000

| Tier | Per-row mount ms | List mount ms | Duplicate-hooks mount ms | Per-row / list evaluations per relevant write | Relevant-write elapsed ms (row / list) |
|---|---:|---:|---:|---:|---:|
| wasm | 593.2 | 22.7 | 19.4 | 1,000 / 1 | 795.7 / 240.3 |
| worker | 1157.8 | 30.4 | 41.0 | 1,000 / 1 | 1260.5 / 278.1 |
| online | 945.8 | 30.4 | 36.1 | 1,000 / 1 | 1050.5 / 228.5 |
| process | 247.5 | 10.2 | 23.2 | 1,000 / 1 | 439.3 / 232.6 |

Write times include the fixed 200 ms settlement wait. All 1,000-row unrelated
writes used zero evaluations and settled in 204–227 ms, dominated by that wait.
The queue trades some mount throughput for responsiveness: baseline wasm point
mount was 238 ms with a 249 ms maximum task; final mount is 593 ms with no >=50 ms
task. The list mounts in 23 ms. Duplicate hooks already shared before this lane;
canonical object-key order closes an additional sharing gap.

## Copied ChatRail

The read-only comparative's `src/ChatRail.tsx:23–27` mounts `membersOf`, then
`profileByPrincipal` using the first other member (viewer fallback), plus
`receiptMember` per row. `witness/per-row-chat.q` copies its profiles,
conversations, members and these three reads, with minimal setup/writes. The
browser reproduces that dependency cascade with real React hooks, including its
initial self-profile observation. It mounts 3N hooks over two distinct members
per conversation; all peers are Bob, so profile hooks share. Process mounts the
three equivalent observations with Bob's argument already known. Avatar assets,
router, Expo widgets, original UI state and the full M3 choreography are excluded.
The relevant write changes Alice's public profile, which also affects the roster
join. Receipt reads need no refresh for that write. Local HTTP attempts can occur
between the change-feed authority cut and replica apply, in addition to device
reevaluation; the controlled count test parks change delivery to measure one cut.

| Tier | Shape | N | Mount ms | Relevant evaluations | Unrelated | Idle CPU ms (main / host) | Longest task ms / lag proxy | Heap / RSS MiB |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| wasm | chat | 100 | 260.9 | 119 | 0 | 8.6 / 0.0 | <50 | 10.9 / 381.0 |
| wasm | chat | 500 | 1871.8 | 519 | 0 | 3.1 / 10.0 | <50 | 18.6 / 586.6 |
| wasm | chat | 1000 | 5676.4 | 1004 | 0 | 52.1 / 150.0 | 52 | 22.6 / 546.3 |
| worker | chat | 100 | 827.5 | 119 | 0 | 3.5 / 10.0 | <50 | 43.4 / 800.3 |
| worker | chat | 500 | 6697.8 | 519 | 0 | 4.0 / 10.0 | <50 | 12.7 / 822.7 |
| worker | chat | 1000 | 27211.5 | 1019 | 0 | 3.8 / 10.0 | <50 | 19.4 / 759.5 |
| online | chat | 100 | 228.3 | 102 | 0 | 2.9 / 10.0 | <50 | 34.4 / 766.8 |
| online | chat | 500 | 2312.9 | 502 | 0 | 58.4 / 130.0 | <50 | 12.1 / 746.0 |
| online | chat | 1000 | 7737.8 | 1002 | 0 | 3.1 / 20.0 | <50 | 18.3 / 745.4 |
| process | chat | 100 | 158.4 | 101 | 0 | 19.0 / 0.0 | 6.9 lag | 47.8 / 632.7 |
| process | chat | 500 | 491.9 | 501 | 0 | 14.8 / 0.0 | 13.5 lag | 43.6 / 640.6 |
| process | chat | 1000 | 942.4 | 1001 | 0 | 13.3 / 0.0 | 13.2 lag | 98.8 / 695.3 |

At N=1,000, browser mount performs 2,002 device evaluations (or 2,010 HTTP
attempts online, including the first cut). Process performs 2,001. Final relevant
write: wasm 1,002 device + 2 HTTP, Worker 1,002 device + 17 HTTP, online 1,002 HTTP,
process 1,001 device. All unrelated/idle query counts are zero. The largest
observed ChatRail main-thread task is 52 ms on wasm; Worker and online have no
>=50 ms entries. Worker removes interpreter work from the main thread but does
not make thousands of joined queries and messages cheap. We did not compare an
identical joined ChatRail list query; the measured list advantage above is for
the same simple point-read fields, and should not be extrapolated to this join.

## Qualification

- Seven N=1,000 count cases pin eight starts per turn, eight concurrent
  evaluations, cancellation/rejection recovery, canonical sharing, N/zero write
  evaluation counts on online/wasm/process, and due-owner-only clock evaluation.
  `clock-counts-final.log` passes 10/10 including private-transfer cases.
- Final broad affected run: **1,424/1,431**, `qualified-tests.log`, including all
  333 delivery fault matrix checks and every full-suite failing file. Six reds
  used the intermediate clock fixture already loaded by that run; the corrected
  complete clock file passes **41/41**. Final follow-ups are **55/55**, including
  those 41, all seven count cases and all seven README examples
  (`final-followups.log`). No introduced failure remains in the affected evidence.
- The seventh broad-run failure is a **baseline** intermittent wasm keep-remount
  timeout. The unchanged entire keep-device file passes **31/31** separately,
  but the same timeout reproduces in isolated old/current SDK copies. Original
  module hashes and exact transpilation matches: `baseline-proof.json`.
  **This baseline issue remains open**, with no suppression or timeout increase:
  [ticket](../../../issues/20260929-snapback4-keep-remount-second-key.md).
  `reproduce-keep-remount.mjs baseline|current 10` reproduces from a built tree;
  final packaged reproducer also fails on baseline iteration one. See the ledger.
- Whole guide: **98/98**, `guide-complete-final.log`; README/guide TSX: **7/7**,
  `readme-final.log`. Typecheck, package build, docs budget and whitespace pass.
- Five isolated original-implementation controls fail for the intended reasons:
  key order fails sharing; online concurrency exceeds eight; empty wasm/process
  applies execute 1,000 queries; non-due clock correction evaluates 1,000 owners.
  See `baseline-controls.log` and `clock-baseline-control.log`.
- The await census only registers `read-work.ts` with **zero awaits**. All 166
  existing site classifications and fault recipes remain unchanged.
- **One full `scripts/test.sh` invocation**, exit 1, exact summary:
  **`== 1 failure(s) in 1397 s`**, failed phase `client tests`. The main client
  runner reports 4,818 tests, 4,785 pass, 23 fail, 10 skipped; separate shards
  passed. Serial client models: **79/79**. All other phases passed.
- All 23 full-suite failures are **ours** and individually named in
  [FAILURES.md](FAILURES.md), with causes, corrections and follow-up evidence.
  No baseline exemption applies to those 23. The blocked ephemeral-capability child was
  terminated after 430 seconds so the remaining suite could complete; its gate
  is fixed and qualified. Some final edits occurred during the serial-model
  phase; the full run is an intermediate qualification, not a final-tree green
  claim. Final affected checks qualify the later changes. No second full run.
- Reference audit: 523 LLP docs, 9,893 refs, zero errors/unchecked.

Text logs retain all results; trailing whitespace and extra blank lines at EOF
are normalized for the repository whitespace check. Every observed failure and
setup correction is recorded in `FAILURES.md`. No
qualification timeout, model sequence count or budget was relaxed. The report
makes no publication, comparative-score improvement or Convex-parity claim.

## Wasm

Canonical local build: **2,042,203 B raw / 593,573 B GNU file-input gzip-9**.
Cap remains **593,719 B**: **146 B headroom, 0 B growth** against this worktree's
pre-change rebuild. SHA-256:
`75104fe4882479ef2bfd8796df9d655853739084640c11457cffbb50309a6e2c`.
The LV journal's different-host artifact was 593,641 B; this report compares local
before/after builds and does not claim byte identity with that artifact. No wasm
source, toolchain or budget changed. Full-suite wasm rebuild reports the same size.
