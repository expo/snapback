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
| 5. Twice-per-condition scale measurements | Completed in `bb8c48955`; **acceptance fails** on acquisition totals and the final 100-conversation live tail |
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
The initial matrix used `16fe7c574`; final Worker samples include the cold-fence
and first-open fixes committed in `bb8c48955`. Its later Node-only claim guard
does not change browser behavior. Ordinary browser semantics are unchanged
between those measurement revisions.

The first final 1,000 sample spends 3.793 s fetching 13 pages and 12.591 s in
terminal apply including strict persistence/RPC, versus 3.758 s and 11.538 s on
the first ordinary sample. Overlapping call durations must not be summed into
total elapsed time. The Worker removes main-thread VM/persistence work but has
not removed enough acquisition cost. Further attribution belongs in the Worker
realm; changing execution location alone does not meet throughput acceptance.
The serial writer advances more quickly when reads stay responsive: the first
final Worker catch-up contains 2,652 events versus the ordinary run's 884. This
is the requested live-writer condition; no normalized substitute is used to
claim that the acquisition target passed.

Fixtures are private reflink copies under this worktree's ignored
`target/lane-ss-round5/scale-{100,1000}`. Only the 1,000 copy was extended by
900 conversations/92,700 seeded rows. The original GS fixture/store/WAL was
never served or modified. Runs were serial on a quiet 96-CPU Linux host, with
no build/test jobs during measurement. CPU-idle/load observations, Chromium
version, actual rows/bytes, per-page/per-call timings, p95 counts, residency and
raw repeats are in [round5-measurements.json](./round5-measurements.json) and
the `round5-{default,worker,final-worker}-{100,1000}-{1,2}.json.gz` files.
Chromium is 151.0.7922.34. Pre-run CPU busy observations span 0.03–2.47%
across 96 CPUs; the final runs' one-minute load is 1.13–1.40. This is a quiet
shared host, not a claim of exclusive machine ownership.
The page acquisition heap peaks are about 23 MiB at 100 and 82 MiB at 1,000;
**these exclude the Worker JS heap** and do not establish total-memory savings
or sublinear growth.

## Qualification and failures

| Check | Result |
| --- | --- |
| Control + existing sync-scale regressions | 23/23 ([log](./round5-controls.log.gz)) |
| Default web-device + server-clock tests | 191/191; original default tests unchanged ([log](./round5-web-and-clock.log.gz)) |
| Chromium Worker protocol | 36/36, zero page errors ([results](./round5-final-worker-protocol.json)) |
| Actual client with Worker held inside terminal apply | 503 recovery, expiry recovery, synchronous admission fence all pass; resumes acquired ([results](./round5-worker-watch.json)) |
| Chromium immediate navigation | Default 10/10; Worker 10/10 ([default](./round5-navigation-default.log.gz), [Worker](./round5-navigation-worker.log.gz)) |
| Chromium IndexedDB witness | Both exit 1 on the same two baseline expectations, below ([default](./round5-idb-default.log.gz), [Worker](./round5-idb-worker.log.gz)) |
| Whole guide | 92 passed, 0 failed ([log](./round5-guide.log.gz)) |
| LLP references | 521 docs, 9,754 refs, 0 errors, 0 unchecked ([log](./round5-ref-check.log.gz)) |
| `scripts/test.sh`, one invocation | **`== 0 failure(s) in 1409 s`**, exit 0 ([complete log](./round5-full-suite.log.gz)) |

The full suite has **no test failures**: Rust 4,162 passed / 30 ignored; client
shards 3,919 passed / 10 skipped; serial models 79/79; fixture wrappers 9/9.
All build, typecheck, release and documentation checks pass. No product change
was made during that run, and it was not repeated. The **60 s suite time budget
remains unmet**, as in round 4; this successful test verdict is not a time-budget
qualification. [Structured results](./round5-qualification.json).

The 36-case protocol run includes the round-4 crash/termination matrix and new
snapshot publication, admission capture, prepared pagehide/old-sync refusal,
conditional commit abort/reopen, orphan/receipt transfer, mixed Worker/default
navigation, public offline reopen, wasm-source forms and empty-open claim release.
The busy-watch witness uses only a test-transformed entry: the Worker pauses
inside terminal `apply`, while the real client's server polling recovers after
503/expiry and stops dispatch as soon as a new admission is captured. The
model-level fence tests additionally cover delayed credentials, authority,
generation/store, acquisition, send revision, queue revision, issued floor,
unknown predictions, held reads and expiry. These are complementary tests, not
a claim that every fault was injected into every full app flow.

Failure accounting:

- **Ours, still failing acceptance:** the acquisition totals and final
  100-conversation live p95 above. No guide section or readiness claim.
- **Baseline, still failing:** `durability.adoptionRejected` and
  `durability.adoptionUnlocked` in both IndexedDB runs. Current main defers
  orphan recovery until a call/authority attachment; the witness expects eager
  open and then abandons its unexpectedly successful owner. The same main
  reproduction is retained with round 4. See the
  [existing ticket](../../../issues/20260928-snapback4-idb-witness-assumes-eager-orphan-recovery.md).
  Every other assertion in both JSON results is true, with zero page errors.
  Worker selection covers ordinary client paths; direct injected-persistence
  fault subcases in that existing witness intentionally remain on the default.
- **Ours, fixed:** all five existing sync-scale tests initially hit the moved
  `queued` helper's temporal initialization error. A hoisted helper fixes them;
  final 23/23 includes all five. The helper extraction also preserves the
  1,500-line source-file limit. An early `async export function` extraction
  typo was corrected before its successful package build.
- **Ours, fixed:** `W11R2: a live sibling queues one cancellable lock wait
  without a timer` initially failed with `indexedDB is not defined`. The
  borrowed lock helper now preserves Node in-memory provider behavior; the
  unchanged test passes in the final 191/191 run. Browser barriers still run.
- **Ours, witness setup fixed:** early busy-Worker trials named the wrong chat
  query/entry extension, assumed published identity on a first acquisition,
  then tried an unjournaled browser online mutation. Corrected to `thread`,
  the actual `.js` entry, reacquisition with an identified store, and a Node
  peer writer. Final three cases pass and the resumed client is acquired.
- **Ours, invocation corrected:** an early navigation log labelled Worker had
  actually used the default after a failed edit path. It is counted only as
  default evidence; the explicit `SS_WORKER=1` repetition is the Worker result.
  Failed relative-path reads/edits were corrected and are not tests or passes.
- **Baseline timing limit:** the complete suite still exceeds its unchanged
  60 s budget (1,409 s here; 1,770 s in round 4). The script reports zero
  failing steps, not compliance with that time budget.
- **Environmental:** no remaining environmental qualification failure.

Early failure logs are retained as `round5-initial-*.gz`. The extra instrumented
100-conversation diagnostic is separate from the acceptance samples; no result
is selected from it to improve the table.

The full suite's canonical wasm build reports **2,019,815 B raw / 585,384 B
gzip**, byte-identical to the round's starting artifact (SHA-256
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`). Delta
**0/0 B**; unchanged gzip cap **586,193 B**, headroom **809 B**. The size uses
`scripts/build-wasm.sh`'s GNU gzip command, as did the starting measurement
([byte/budget record](./round5-wasm.json)).

Orientation/affected corpus audit: LLP 3000 and 2000.000 retain the product and
budget boundaries; LLP 3000.007 §20.4 now describes the implemented opt-in and
misses; §18.2, LLP 3000.016 §2.2 and LLP 3000.019 §3.3 still govern store/read
authority and live polling; LLP 3000.022 §4 still requires commit-point
conditional delivery. The sync card was read and left unchanged because its
new recommendation is gated. No new LLP or independent design ruling was needed.

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
