# Lane SS round 1 — review fixes and scale limits

2026-09-27, expo-build-1000, `sb4-intent/ss-sync-at-scale`.
Round 0 ends at `db6a357f0`. First fetched and merged `origin/main` at
`47ea5918b`; the sole conflict was two journal appends, both retained.
No push, publication, tool installation, version or budget change.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Round-1 change |
|---|---|
| `packages/snapback4/src/local.ts` | Move `serverRead = true` into the branch publishing an accepted server answer. A failed, prediction-fenced or expiry-withheld background refresh preserves the previous answer's origin and the 250 ms acquisition timer. |
| `packages/snapback4/test/sync-scale.test.mjs` | Three regressions hold terminal catch-up, publish a message, inject one 503 / a persisted queued prediction / an already-expired server reply, recover, delete the first message and send another from Alice to Bob. Each asserts delivery before acquisition, zero device publications and the same held catch-up. |
| `crates/snapback4-core/src/engine/row_views/batch/tests.rs` | Add a tombstone and self-send to all fifty scalar comparisons, with explicit own/other-member counts; add finite `Cut::Cap` admission at the public batch entry. |
| `crates/snapback4-core/tests/sync_count_batch.rs` | Add tombstone and self-send to real snapshot/stream delivery, retain image/watermark checks and compare all fifty values to scalar query certification. |
| `witness/sync-scale.mjs` | Record send start times and event-loop gaps; optional GC attribution and a diagnostic completed-fake-transaction reclamation control. Keep timing measurements separate from post-close GC. |
| `reports/20260927-ss-sync-scale/round1-measurements.json` | Retain per-run phase/page/sample measurements, GC checkpoints, raw-witness hashes, summaries and mutation-control commands/results. |
| `reports/20260927-ss-sync-scale/ROUND1.md` | This report, exact qualification and reproductions. |
| `JOURNAL.md` | One dated round-1 append; previous entries unchanged. |

`runLocal` still receives no watch in the background path. There is no change
to `ReadObservation.fetch`, its `finally`, authorization, expiry, prediction
fences, staged publication or persistence. Normal reruns still record local
answers and retire acquisition polling. This follows the existing LLP
3000.019 §3.3 / 3000.016 §2.2 publication procedure. No design LLP is needed.

## Tests and failing controls

- The 503 and queued-prediction tests both fail on the unmodified round-0
  client at `message after unpublished refresh, before acquisition ends`.
  Restoring the old assignment in the built client also fails all three new
  tests, including the expiry case, at that same assertion. The predicted
  outbox entry is persisted with the real wasm `enqueue` operation, as if
  another owner left it; removing it uses `dequeue`. These bypass SDK watch
  invalidation deliberately, isolating background refresh recovery. No SDK
  retry, sync release or unrelated rerun rescues the observation.
- A live tombstone contributes to no member; a self-send contributes to all
  applicable other members but not its sender. Batch certification decodes
  1,002 live source rows, scalar certification 50,100. Snapshot delivers and
  certifies at most 2,004 source rows; 250 logged puts certify 1,002 once.
  Fifty scalar query reads independently confirm the sync values, also with
  50,100 source rows. Stream watermark remains 2.
- The capped-admission test has one readable member and one contributing
  message. `examined: 1` pays for the member lookup; the source admission
  attempts unit 2. With `Cut::Cap` and finite default allowances elsewhere,
  `live_aggregate_batch()` returns `Bound { Examined, actual: 2, ceiling: 1 }`
  without scanning a source row. An uncapped control certifies 1.
- Five Rust mutation runs all fail assertions: remove `require_uncapped()`
  (the new cap test); clear each source tombstone (both equivalence and sync
  delivery); replace each source sender with a non-member (both tests).
  All source bytes were restored before the passing runs and full suite.
  No mutation survived. Raw logs and the driver are under
  `target/lane-ss-round1/mutation-*` and `mutations.json`.

Affected results: **18/18** row-view unit tests, **1/1** sync delivery test,
**198/198** SDK tests (sync-scale, prediction routing, presence and read
observation), **86/86** whole guide tests. Package typecheck/build, reference
audit (517 LLPs, 9,623 references, zero errors) and whitespace checks pass.
The SDK total includes all five sync-scale tests, three new this round.
Transient test-authoring mistakes (the Rust value variant, qualified query
name and scalar result shape) were lane-owned and corrected before these
results; the intentional mutation failures are negative controls.

## Acquisition delivery remains above one second

Nearest-rank p95 pools four fresh acquisitions per persistence mode, sending
until acquisition finishes, including the terminal publication boundary.
All sends arrived; none timed out. These are Node/wasm SDK measurements,
not browser rendering. Main's server and the restored 250 ms SDK are used.

| Cadence | Persistence | Samples | During-acquisition p95 | Maximum |
|---|---|---:|---:|---:|
| 250 ms, final | memory | 33 | 1.119 s | 1.242 s |
| 250 ms, final | fake IndexedDB | 31 | 1.398 s | 1.490 s |
| 100 ms, isolated experiment | memory | 28 | 1.158 s | 1.159 s |
| 100 ms, isolated experiment | fake IndexedDB | 31 | 1.566 s | 1.805 s |

The faster cadence did not improve p95, so it is not a product change. The
experiment used a copied built package under `target/lane-ss-round1/`, with
only that interval changed. The full suite's compile phase overlapped the
experiment, so these shared-host numbers do not establish a causal slowdown.
They establish no reliable improvement. The first copied-package attempt
missed its `#fetch` import map; that lane-owned harness error was corrected
before sampling. No package or installed dependency was modified.

The SDK already invalidates/reruns watches on each device apply, including
staging pages. Adding that wakeup again would duplicate existing behavior.
The remaining boundary is the atomic apply plus the next sync response,
not an idle gap between acquisition pages. In `during-memory-4.json`, the
terminal sync starts at 1422 ms and takes 381 ms; the later message starts
at 1689.84 ms and commits in 11.42 ms, after that response's database cut.
Terminal apply starts at 1809.45 ms and takes 533.12 ms (12.65 ms saving).
After publication a covered local query can answer the published cut; the
next sync starts at 2401 ms and takes 363 ms. The watch receives the later
message at 2808.76 ms, **1118.91 ms** after send. Its largest event-loop gap
is **615.07 ms**. Across the four IDB-shaped runs terminal apply is
744–803 ms including persistence, with event-loop gaps of 471–488 ms.

I found no clear safe timing improvement in this round. Returning private
staged rows, loosening query fences or advancing a watermark beyond its
transaction is outside the brief and was not done. This does not claim that
all possible safe optimizations have been exhausted. A worker or a different
publication strategy needs its own design and qualification.

## The 1,000-membership heap

**Most of the 1.87 GB JS heap is fake-indexeddb's retained transaction
history, not a corresponding SDK JS heap requirement.** The final replay
reproduces **1.859 GB** sampled peak. After SDK close and three GCs, **1.556
GB** remains. Removing only completed transactions from the fake's internal
database lists, leaving all live object-store records intact, reduces that
to **183.85 MB**: **1.372 GB released**, 88.2% of the retained JS heap.
There are 218 completed simulated transactions and 129,712 rollback entries;
`fake-indexeddb` 6.2.5 retains them in `Database.transactions`, including
`FDBTransaction._rollbackLog`, request results and completion closures.
This is measured retention, not an inference solely from its in-memory design.

A separate run keeps the same production SDK, wasm and persistence adapter,
but releases completed fake transactions after every save. Acquisition is
**42.236 s**, versus **41.467 s** normally; sampled peak is **844.20 MB**,
versus **1,859.34 MB**; post-close GC is **183.81 MB**, essentially identical
to removing history afterward. Both runs send all 23 messages and complete.
Their twenty post-acquisition sends have p95 **0.654/0.611 s** respectively.
The control does not claim that 844 MB is an SDK-only allocation: it still
contains live fake storage, an active transaction and transient SDK work.
Deleting simulated databases releases another ~4 MB in these checkpoint
frames; the remaining ~180 MB is not fully attributed by this experiment.

The matching memory-persistence run acquires in **26.893 s**, peaks at
**161.81 MB** JS heap and returns to **10.67 MB** JS heap after SDK close and
GC. A separate important SDK cost remains: sampled external memory is
**1.383 GB** for memory persistence and **1.515 GB** for IDB-shaped, with
about **1.366 GB** retained after close in both. The wasm runtime/linear
memory remains process-global. This is not fake-indexeddb's JS transaction
history, and it is not removed by this patch. Peak RSS is **1.786/3.407 GB**
(memory/IDB-shaped). The round-0 1,000-member SDK publication and external
memory limitation therefore remains real even after attributing the fake's
heap excess. Largest atomic applies are **19.043 s** memory and **24.838 s**
IDB-shaped, including **0.301/9.457 s** saving; the IDB-shaped run records a
**14.714 s** event-loop gap. No Chromium/disk footprint is inferred from
these measurements.

The final heap probes finish acquisition in a separate async function before
GC, avoiding retention of that function's lexical locals by the probe itself.
Earlier attribution runs are also retained in the JSON and clearly labelled
`heap-1000-*`; use `heap-final-*` for the figures above. CPU-heavy full-suite
qualification overlapped these controls, so timing differences between heap
runs are not product improvement claims.

## Existing forms that compile and run

No new syntax, diagnostic or SDK API. The scalar/batch fixture compiles and
runs this existing row-keyed view and point query (the full schema is
`crates/snapback4-lang/tests/fixtures/row-keyed-view.q`):

```quarry
view unread: count messages by members m
  where .conversationId = m.conversationId and .ordinal > m.readUpTo
    and .senderId != m.principal and not .tombstone and .ordinal > m.joinedAt
query unreadFor(member: members):
  return unread[member]
```

The held-acquisition SDK tests exercise the existing watch form:

```js
const watch = client.observe({ kind: 'query', name: 'history' }, {});
const unsubscribe = watch.subscribe(() => console.log(watch.getSnapshot()));
```

## Reproduction and remaining work

Build the package and release server as in the round-0 report. Reuse or copy
only the lane's private fixtures, never the original GS store. Serve the
100-member copy on 49371 and its 1,000-member extension on 49372 with
`snapback4 dev --replay`. From `snapback4/`:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
node --test packages/snapback4/test/sync-scale.test.mjs
cargo test -p snapback4-core --lib engine::row_views
cargo test -p snapback4-core --test sync_count_batch
cargo test -p snapback4-lang --test guide
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49371 target/during.json memory during
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49371 target/during-idb.json idb during
SS_HEAP=1 node --expose-gc witness/sync-scale.mjs http://127.0.0.1:49372 target/heap.json idb
SS_HEAP=1 SS_FAKE_RECLAIM=1 node --expose-gc witness/sync-scale.mjs http://127.0.0.1:49372 target/heap-control.json idb
```

Repeat each `during` command four times into distinct outputs for the pooled
sample. `SS_HEAP` measures normal acquisition and 23 sends (three warm-ups,
twenty measured), closes the SDK, runs three GCs, then releases completed
fake transactions and finally deletes the simulated databases, measuring
between each. It acts only on that Node process's fake IndexedDB.
`SS_FAKE_RECLAIM` additionally releases finished simulated transactions after
each save; it is a diagnostic control, not production persistence behavior.

Open problems: the 100-member during-acquisition p95 above one second; the
1,000-member terminal apply and wasm/external footprint; browser/disk memory
and durability not measured here. The commands above reproduce them. No
review finding is left unfixed; these disclosed performance limits remain.
No original GS store or WAL was served or modified.

## Full qualification and wasm

Ran `scripts/test.sh` **exactly once** this round, exit **0**. Exact final
summary: **`== 0 failure(s) in 1057 s`**. Every failure, classified: **none**
(lane-owned 0, baseline 0, environmental 0). Rust: **3,888 passed / 24 existing
ignored** in 587 s. Main SDK run: **2,638 passed / 10 existing skips**, plus
**56/56** in seven acquisition/server shards, client phase 195 s. Serial
models: **78/78**, 258 s. Fixture wrappers: **9/9**. Both app typechecks,
native/wasm builds, docs budget, release guard and package checks pass.

Command environment: Node 24.13.1, Bun 1.3.14, Rust 1.97.0, eight Cargo jobs,
dev/test debug information disabled, fd limit 65,536, and the existing
worktree-local `target/lane-ss-evidence/bin` Node/Bun symlinks ahead of Cargo
and the system paths (no old wasm-opt). No tool was installed. Full log and
exit: `target/lane-ss-round1/full-suite.log` and `full-suite.exit`. The inherited
60 s total budget remains exceeded; no budget or deadline was raised.

Wasm rebuild: **1,981,512 B raw / 572,049 B gzip**, both unchanged from
round 0, SHA-256 `1be50bb70f066dcfb224e9c26149c9a734a385f101429be26e3f5a504dec4928`.
The unchanged budget is 572,841 B (792 B headroom). `local.ts` remains 1,489
lines; every modified source file stays below 1,500. No engine production
code changed in round 1. The host's optional wasm-opt 108 still cannot
process sign-extension instructions; as in round 0, the full suite uses the
supported no-optimizer path via existing worktree-local Node/Bun symlinks.
