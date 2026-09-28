# SS round 5 — Worker adapter and measured acceptance misses

2026-09-28. Branch `sb4-intent/ss-sync-at-scale`. Local commits only; nothing
pushed, published or landed. `git fetch origin && git merge origin/main`
completed first, reporting already up to date. Round 4's foundation commit
is `f3d56c067`. Its removal of round 3's unlanded Rust copy reductions remains.

## Outcome and ordered steps

| Step | Status |
| --- | --- |
| 1. Control snapshot and cold-watch bypass | Implemented and tested; commit `d3fe92105`, with measurement-driven fence correction below |
| 2. Prepared suspension dispatch | Implemented and tested; commit `11d68425d` |
| 3. Orphans, receipts and conditional delivery commit | Implemented and tested; commit `fa970ff41` |
| 4. Public adapter, mixed navigation, bundle and offline reopen | Implemented and tested; commit `16fe7c574`, with first-open/default-provider corrections below |
| 5. Twice-per-condition scale measurements | Completed; **acceptance fails** on acquisition totals and the final 100-conversation live tail |
| 6. Sync-card section | **Not done:** expressly gated on steps 1–5 passing |

At 1,000 conversations the final Worker samples meet the main-thread and live
p95 targets, but acquisition takes **28.945/30.259 s** against **27 s**. At
100 it takes **5.291/4.997 s**, versus **4.216/4.216 s** on the ordinary host.
The option is implemented and measured, but **not ready to land**. Independent
review remains outstanding; these are implementation and qualification results,
not a review verdict. The 8/12 s Node targets from rounds 2–3 remain unresolved
and were not remeasured by this browser-only implementation.

## Protocol and changes

The page retains its exclusive store claim, synchronous admission journal,
credentials and dispatch. The Worker owns the unchanged wasm VM and strict
IndexedDB saves. Large row/staging/change arrays stay in that realm.

`device-control.ts` publishes store/generation, acquisition incarnation,
prediction tables, queue revision, issued-time floor and restore/send fences
only after durable calls. Synchronous admission capture advances page authority
before its Worker request exists; an older completion acknowledges only its own
id. Unknown predictions block. Revision numbers remain monotone across restart.
Temporary control barriers expose unknown authority without removing the cold
capability, so a fenced watch withholds instead of joining the busy VM queue.

`local-query.ts`, `local-reads.ts` and `local.ts` admit only already wholly
server-answered watches during cold acquisition. They use the same snapshot at
dispatch and final delivery, including credential, incarnation, expiry, store,
head/floor and queued-write checks. Held reads, local composition, remembered
fallback and supplementary delivery collection are disabled on this route.
Composed server/local reads do not earn eligibility. The default opener supplies
no capability and follows its existing query path.

`web-worker-suspend.ts` prepares the bound oldest head's `begin_send` in a strict
transaction before granting the page one-use permission. Every newer enqueued
call, including a sync capture, synchronously invalidates that permission. A
previous capture has the older send revision. At pagehide the client validates
credentials, the helper rechecks control and revision, and the exit journal is
written synchronously before keepalive. A stale/unprepared head remains durable;
this is not a guarantee that every busy pagehide sends.

`web-worker-device.ts` integrates admission authority, journal recovery, media,
outbox notices and committed-result callbacks. A lost reply discards the VM;
subsequent work restores under the retained claim. `web-worker-orphans.ts`
restores source rows only inside the source Worker, transfers outbox custody
with original ids and new destination order, shares terminal receipts before
source deletion, and waits for live owners. The source claim lasts through
Worker shutdown and deletion. Refused local admission remains a known refusal
even when later cancellation bookkeeping fails.

For LLP 3000.022 §4, only `device:delivery:` metadata crosses to the page for
conditional persistence. The page's `current()` closure runs inside the strict
IDB transaction immediately before explicit commit. Abort discards mutated
Worker memory before reuse. No function is cloned or earlier check substituted
for the commit-point check.

`web-ownership.ts` and `web-receipts.ts` extract the ordinary host's existing
helpers. Both browser openers wait for the previous Worker's lifetime lock and
IDB barrier after claiming the store, covering mixed navigation. A failed
quiescence barrier retains custody. A Node in-memory provider borrowing the lock
helper does not access nonexistent IndexedDB. An empty offline Worker open reads
only backend metadata under the exclusive, quiescent claim; absence produces the
same first-install refusal before launching a redundant Worker.

The public form is:

```js
const client = await createLocalClient({
  url, session, device: webDevice({ worker: true }),
});
```

The default remains `webDevice()`. Worker mode uses default IndexedDB; combining
it with `persist` explicitly refuses. Custom providers remain supported on the
ordinary host. The bundled entry supports offline shell/wasm reopen and supplied
URLs, bytes, Response promises and compiled modules. Costs include another realm,
RPC, control metadata and Worker startup. Total Worker memory and a broad
supported-browser/bundler matrix are not qualified here. Do not make this default
before acquisition targets, protocol review, startup/JS bytes and total-memory
costs are acceptable.

## Chromium measurements

The existing witness uses a fresh browser context for every acquisition and a
Node peer continuously sending, one acknowledged/observed message at a time.
The two ordinary and two final Worker runs per size are below. All have zero
timeouts and zero page errors. Long tasks are restricted to the acquisition
window; `0` means no Long Tasks API entry (its threshold is 50 ms).

| Host / conversations | Acquisition s | During p95 ms | During maximum ms | During samples | Longest main task ms | After p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Default / 100, run 1 | 4.216 | 2467 | 2467 | 5 | 377 | 679 |
| Default / 100, run 2 | 4.216 | 2451 | 2451 | 5 | 376 | 684 |
| Worker / 100, run 1 | 5.291 | 1686 | 1686 | 13 | 50 | 697 |
| Worker / 100, run 2 | 4.997 | 1019 | 1019 | 17 | 0 | 702 |
| Default / 1,000, run 1 | 27.066 | 12517 | 12517 | 19 | 6946 | 823 |
| Default / 1,000, run 2 | 26.876 | 12719 | 12719 | 19 | 6892 | 935 |
| Worker / 1,000, run 1 | 28.945 | 516 | 1426 | 101 | 55 | 815 |
| Worker / 1,000, run 2 | 30.259 | 515 | 1312 | 102 | 53 | 887 |

The subsecond p95 is not a claim that every message arrived within one second;
the maxima and changed sample counts are explicit. At 100 even p95 remains above
one second. Initial Worker measurements before the fence/first-open corrections
were 5.559/5.403 s at 100 and 29.189/29.156 s at 1,000, with during p95
865/834 ms and 1182/1355 ms respectively. The final 100 tail did not improve;
these misses are not discarded or replaced by the better initial samples.

The first final 1,000 sample spends 3.793 s fetching 13 pages and 12.591 s in
terminal apply including strict persistence/RPC, versus 3.758 s and 11.538 s on
the first ordinary sample. Overlapping call durations must not be summed into
total elapsed time. The Worker removes main-thread VM/persistence work but has
not removed enough acquisition cost. Further attribution belongs in the Worker
realm; changing execution location alone does not meet throughput acceptance.

Fixtures are private reflink copies under this worktree's ignored
`target/lane-ss-round5/scale-{100,1000}`. Only the 1,000 copy was extended by
900 conversations/92,700 seeded rows. The original GS fixture/store/WAL was
never served or modified. Runs were serial on a quiet 96-CPU Linux host, with
no build/test jobs during measurement. CPU-idle/load observations, Chromium
version, actual rows/bytes, per-page/per-call timings, p95 counts, residency and
raw repeats are in [round5-measurements.json](./round5-measurements.json) and
the `round5-{default,worker,final-worker}-{100,1000}-{1,2}.json.gz` files.
The page acquisition heap peaks are about 23 MiB at 100 and 82 MiB at 1,000;
**these exclude the Worker JS heap** and do not establish total-memory savings
or sublinear growth.

## Qualification and failures

Final qualification is recorded below after the single full-suite run finishes.

## Reproduction

From `snapback4/`, with existing Node 24.13.1/Bun 1.3.14 symlinks confined to this
worktree and no tool installation:

```sh
export PATH=$PWD/target/lane-ss-round4/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun run --cwd packages/snapback4 build
node --test packages/snapback4/test/web-*.test.mjs packages/snapback4/test/server-clock-wire.test.mjs
node --test packages/snapback4/test/sync-scale.test.mjs
node witness/worker-protocol.mjs target/lane-ss-round5/final-worker-protocol.json
node witness/worker-watch.mjs target/lane-ss-round5/worker-watch.json
SS_WORKER=1 node witness/navigation-immediate.mjs
SS_WORKER=1 node witness/idb.mjs
node witness/navigation-immediate.mjs
node witness/idb.mjs
cargo test -p snapback4-lang --test guide
# Serve only the private copy with target/release/snapback4 dev --port 0 --no-watch.
# Repeat each mode twice for each size, on a quiet host:
node witness/sync-scale-browser.mjs URL target/default.json
SS_WORKER=1 node witness/sync-scale-browser.mjs URL target/worker.json
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

The local PATH selects the existing supported build path without the host's
incompatible optional wasm-opt. No wasm ABI, contract, Rust product code or
budget is changed by round 5. Existing browser tests remain unchanged except
for the explicit Worker-mode harness selection. Worker fault hooks exist only
in witness-generated/transformed entries.
