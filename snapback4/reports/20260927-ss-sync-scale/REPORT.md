# Lane SS: cold acquisition and live messages

2026-09-27, `expo-build-1000`, branch `sb4-intent/ss-sync-at-scale`.
Base: `54099bc882c529713f6e6204c5f51181f696a8ef`.

The 100-membership acquisition and steady-state targets pass at the SDK
boundary: acquisition takes 1.86 s with memory persistence and 2.35 s with
IndexedDB-shaped persistence; live messages arrive below 0.46 s p95 after
acquisition. **The one-second target throughout acquisition remains unmet:**
including sends spanning terminal publication gives 1.09/1.40 s p95. The original
debug server reproduced a message that never arrived within the probe's 31 s
deadline. Its acquisition took 33.68 s. An optimized baseline with the original
SDK took 7.86 s to acquire and 6.25 s p95 to deliver messages.

## Measurements

| Fixture / implementation | Persistence | Acquisition | Login + acquisition | Live during p95 | Live after p95 | Peak JS heap |
|---|---|---:|---:|---:|---:|---:|
| 100, original debug | memory | 33.681 s | 34.079 s | — | warm-up timed out at 31 s | 179.1 MB |
| 100, original release + SDK | memory | 7.858 s | 7.910 s | — | 6.252 s | 181.5 MB |
| 100, original release | IDB-shaped | 9.656 s | 9.708 s | — | not sampled | 183.8 MB |
| 100, fixed | memory | 1.858 s | 1.905 s | 1.092 s | 0.427 s | 131.5 MB |
| 100, fixed | IDB-shaped | 2.348 s | 2.384 s | 1.397 s | 0.454 s | 211.7 MB |
| 1,000, fixed | memory | 21.378 s | 21.423 s | not sampled | 0.483 s | 207.7 MB |
| 1,000, fixed | IDB-shaped | 41.580 s | 41.625 s | not sampled | 0.973 s | 1,866.8 MB |

Times begin before client construction, including wasm opening, staging,
terminal catch-up, publication and persistence. Login is separately measured;
fixture discovery and sender login are outside acquisition. After-acquisition
p95 is nearest-rank over 20 consecutive sends after three warm-ups, measured
from the second client's mutation invocation to the watched message id. Each
during-acquisition p95 pools four fresh acquisitions, continuing sends until
acquisition finishes: 28 memory and 30 IDB-shaped samples. Earlier probes
stopped after five sends per acquisition and measured 0.257/0.320 s p95;
those results missed the publication boundary and do not establish the
whole-acquisition target. Both sets are retained in the measurement record.
No measured fixed 100-member send timed out.

The 100-member acquisition has five sync responses, 15,588 rows and about
4.655 MB of JSON, including public feed/profile data and the 500-message
horizon. The synthetic extension has 1,000 conversations, 110,088 acquired
rows, 30 responses and about 41.967 MB of JSON: 900 additional conversations,
two members and 100 messages each. This establishes that explicit fixture,
not 1,000 copies of a 10,000-message busy group.

| Acquisition phases | Original release memory | Fixed memory | Fixed IDB-shaped | 1,000 memory | 1,000 IDB-shaped |
|---|---:|---:|---:|---:|---:|
| Sync request-to-body total | 6,425.6 ms | 479.7 ms | 466.7 ms | 2,874.5 ms | 2,825.2 ms |
| Device apply, excluding saves | 820.1 ms | 755.6 ms | 757.4 ms | 16,726.9 ms | 18,744.9 ms |
| All persistence saves | 16.7 ms | 16.0 ms | 504.0 ms | 243.3 ms | 18,414.2 ms |
| Gaps between sync responses and next requests | 414.8 ms | 421.9 ms | 635.5 ms | 4,280.7 ms | 13,011.9 ms |
| Event-loop idle within those gaps | 0 ms | 0 ms | 0 ms | 0 ms | 0 ms |

Gaps overlap apply/persistence; the rows must not be added together. Request
time includes loopback transport and receiving the body, not isolated server
CPU. Per-page timings, rows and bytes are retained in `measurements.json`.
There was no idle backoff between acquisition pages. The baseline's expensive
page was 6,317.4 ms; the debug version spent 31,729.0 ms there.

Node 24.13.1, Bun 1.3.14, Rust 1.97.0, Linux x86_64, 96 cores, shared host.
Baseline and fixed release binaries use the same ordinary Cargo/SQLite build
policy; these are source-build measurements, not qualified publication
tarballs. The final original-SDK baseline overlapped other test compilation.
Runs share a private fixture with accumulated probe sends; its acquisition
row count stays fixed. The first five-send during-acquisition samples precede
the final extra heap/step reservations; the final boundary, cold and 1,000 runs
include those reservations.

IDB-shaped means `fake-indexeddb` running the production `indexedDbStore`,
including transaction-completion waits. It does not measure Chromium, disk
latency or browser memory. Peak JS heap is sampled process `heapUsed` over
acquisition and live sends, not an exact allocation high-water mark. At 1,000,
memory/IDB-shaped peak external memory was 1,375.3/1,514.7 MB and peak RSS
1,798.8/3,412.8 MB. The in-memory IDB simulation duplicates storage in JS;
the JS heap column is not the wasm footprint.

## Cause and fix

An expiring, row-keyed `unread` view must certify its current live input at
delivery. Snapshot and stream delivery repeated the same source walk for
each of 50 members, decoding about 500,000 messages for the busy group.
Several logged puts for the same member repeated it again. A long request
can keep the network heartbeat alive while delivering no new watch result.

The server now certifies at most 256 member images in one batch, sharing a
source walk within each parent and evaluating each member predicate. The
member and parent checks, every source row's authorization/disclosure boundary,
expiry and current transaction remain mandatory. Repeated stream puts reuse
only the current read transaction's certified image. No cache survives a
transaction. Unsupported forms and member-horizon selection retain their
existing scalar path. Scratch, output images, deduplication and each predicate
are metered; writes and budgets are unchanged.

Cold acquisition also holds the change-feed loop until the staged partition
is published. A watch answered by the server could otherwise remain stale
through that interval. While acquisition is active, the SDK refreshes such
mounted watches at 250 ms using its existing background-read path and its
authority, incarnation and publication fences. It stops at acquisition,
unmount or close. This returns authorized server answers while the device's
staged rows remain private and durable publication remains atomic.

## File map

Paths below are relative to `snapback4/`.

| File | Change |
|---|---|
| `crates/snapback4-core/src/engine/row_views.rs` | Wires server-only batch module. |
| `crates/snapback4-core/src/engine/row_views/batch.rs` | Bounded live certification, per-member rules and metered source walks. |
| `crates/snapback4-core/src/engine/row_views/batch/tests.rs` | Four scalar-equivalence, authorization, expiry and meter tests. |
| `crates/snapback4-core/src/partition.rs` | Uses batches in snapshot and stream delivery. |
| `crates/snapback4-core/src/partition/counts.rs` | Batches and deduplicates stream certifications within the read transaction. |
| `crates/snapback4-core/tests/sync_count_batch.rs` | Counts actual source scans through snapshot and stream entry points. |
| `packages/snapback4/src/local-reads.ts` | Records whether a watch answer came from the server. |
| `packages/snapback4/src/local.ts` | Temporarily refreshes server-backed watches during acquisition. |
| `packages/snapback4/test/sync-scale.test.mjs` | Tests messages, deletion, publication isolation and refresh cleanup. |
| `witness/sync-scale.mjs` | Repeatable Node/wasm acquisition and live latency probe. |
| `witness/sync-scale-extend.mjs` | Builds the private 1,000-membership fixture. |
| `reports/20260927-ss-sync-scale/measurements.json` | Durable phase, page, sample, heap and wasm measurements. |
| `reports/20260927-ss-sync-scale/REPORT.md` | This report and reproductions. |
| `JOURNAL.md` | One dated append with outcome, evidence and limits. |

## Existing forms exercised

No new language, SDK call, diagnostic or guide code is introduced. The builder's
existing program compiles and runs unchanged, including:

```quarry
view unread: count messages by members m
  where .conversation = m.conversation and .ordinal > m.seenOrdinal and .sender != m.principal and not .tombstone
query unreadFor(member: members):
  return unread[member]
```

The SDK probe uses the existing client and watch forms against the fixture's
`messaging.history` query:

```js
const client = await createLocalClient({ url, session,
  device: webDevice({ wasm, persist: memoryPersistence() }) });
const watch = client.observe(
  { kind: 'query', name: 'messaging.history' }, { conversation });
const unsubscribe = watch.subscribe(() => console.log(watch.getSnapshot()));
```

During acquisition the witness uses the existing `prepareClient`/`start`
sequence so it can mount that same watch before acquisition finishes.

## Tests and wasm

New tests:

- Fifty members × 1,000 live source rows: batch equals all scalar answers,
  with 1,000 decoded rows instead of 50,000; 200 expired rows are excluded.
- Member/parent authorization, missing members and revocation on the next
  call: unauthorized parents are never scanned.
- Mixed parents and clock expiry: incorrect cached values and pending flags
  cannot substitute for the current live basis.
- Heap pre-admission and examined/steps/heap exhaustion: the batch aborts
  under the existing meters rather than evading them.
- Actual snapshot and stream delivery: snapshot source scans stay at 2,000
  (ordinary message delivery plus certification); 250 repeated puts for 50
  members use 1,000 source scans, with identical images and intact watermark.
- Actual wasm SDK with terminal catch-up held: consecutive messages and a
  deletion reach the watch while `acquired` remains false and no device
  publication occurs; refreshes are paced and stop after acquisition.
- Closing the watch stops refreshes while acquisition remains held.

Targeted results: row-view tests 17/17; partition regression 1/1; new SDK
tests 2/2; adjacent SDK history/presence plus the new tests 54/54; whole guide
86/86; package typecheck and build pass. The performance regression tests
pin work counts and blocked-publication behavior rather than fragile host
wall-clock deadlines. Reference audit passes.

Full `scripts/test.sh`, run once: **`== 0 failure(s) in 1431 s`**, exit 0.
No lane-owned, baseline or environmental failure in this run. Rust passed
in 952 s; ordinary client tests passed 2,635 with ten skips in 200 s; the
serial client models passed 78/78 in 263 s. Both new SDK tests passed in
this full run. The inherited 60 s total budget remains exceeded; no budget
or timeout was raised. The command used eight Cargo build jobs, stripped
dev/test debug information, a 65,536 file-descriptor limit and the isolated
PATH described below. Exact log: `target/lane-ss-evidence/full-suite.log`.

Wasm: 1,981,512 B raw before and after (delta 0); gzip 572,053 → 572,049 B
(delta −4). Unchanged budget 572,841 B, leaving 792 B. The new server helper
is SQLite-only. Baseline/final hashes are in `measurements.json`.

## Reproduction and remaining limits

From `snapback4/`, install dependencies, build the package and the release
binary with the documented PATH. Copy the entire store directory, including
its WAL, while its server is stopped. Never serve or seed the original:

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH
bun install --frozen-lockfile
# Isolate this host's old optional wasm-opt without changing installed tools.
mkdir -p target/ss-repro/bin
ln -s "$HOME/.local/bin/node" target/ss-repro/bin/node
ln -s "$HOME/.local/bin/bun" target/ss-repro/bin/bun
export PATH=$PWD/target/ss-repro/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
cargo build -p snapback4 --release
mkdir -p target/ss-repro
cp -a /home/ccheever/sb4-intent/gs-store/scale-1790491840 target/ss-repro/scale
# In another terminal, from target/ss-repro/scale:
../../release/snapback4 dev --port 49371 --replay
# From snapback4/:
node witness/sync-scale.mjs http://127.0.0.1:49371 target/ss-repro/memory.json memory
node witness/sync-scale.mjs http://127.0.0.1:49371 target/ss-repro/idb.json idb
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49371 target/ss-repro/during.json memory during
```

For 1,000, stop the private server, copy its directory again, serve the second
copy on 49372, run `node witness/sync-scale-extend.mjs http://127.0.0.1:49372`
once, then run both probe modes against 49372. The baseline was built from
the base commit with the same build settings; its original package and wasm
were separately retained for the final memory comparison. Raw logs and JSON
remain in `target/lane-ss-evidence/` in this worktree. No write targeted the
GS original; source store/WAL hashes are retained there.

Open 100-member target miss: continue sending through publication with the
`during` command above, four times per persistence mode. Memory samples
spanning that boundary were 1,077–1,124 ms; IDB-shaped samples were
1,342–1,410 ms. One concrete memory run sent its last message after the
terminal response's database cut: the 556 ms atomic apply could not contain
it, and the watch waited for the next 366 ms sync response. The analogous
IDB-shaped apply took 760 ms. Timers and query completions cannot publish
through the synchronous wasm portion, and queued device reads wait for the
durable commit. Returning staged rows or advancing the watermark to include
this uncommitted message would violate the existing publication contract.
This lane stops short of such a change. A worker/asynchronous publication
design needs supervisor consideration; this report does not claim that all
possible safe optimizations have been exhausted.

Open 1,000-member performance limit: the fixture's largest device apply is 13.83 s
with memory persistence and 25.24 s including IDB-shaped persistence. This
is terminal atomic publication, not server acquisition. The synchronous
portion blocks the Node event loop; sub-second delivery throughout that
publication is therefore not established. Reproduce with the 1,000 commands
above and inspect `callTimeline` for `apply`. This lane does not change the
staging/durability design to split publication. No Chromium run or native
disk-persistence qualification is claimed.

Environmental build issue: the host's optional `wasm-opt` is version 108 and
rejects the generated sign-extension instructions (`i32.extend8_s`). Running
`bash scripts/build-wasm.sh` with it on PATH reproduces the failure. Baseline,
final and full suite use the supported no-optimizer path: an isolated PATH
containing Node/Bun symlinks and Cargo, without that old `wasm-opt`. No tool
installation, source build-script change or budget increase was made.

Engineering decisions where the brief was silent: 256-member batches;
transaction-local deduplication; 250 ms temporary watch refresh; deterministic
work-count tests; 900 two-member/100-message groups for the scale extension.
These preserve the established certification and staged-publication design,
so the evidence lives here and in the journal rather than a new design LLP.
The explicit deviation from the performance brief is the remaining
publication-boundary p95 miss above; it is reported rather than obscured by
the earlier, incomplete sampling window.
Implementation annotations cite LLP 3000.019 and the governing live-count
contract in LLP 3000.015. There is no new syntax or deliberate change to a
previous test's expected semantics. No push, package publication, version
bump, contract reshaping or supervisor-owned blind review was performed.
