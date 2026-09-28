# Lane SS, round 3 — publication copies and browser execution boundary

Date: 2026-09-27. Branch: `sb4-intent/ss-sync-at-scale`.

The **8 s memory / 12 s IndexedDB-shaped acquisition targets and the one-second
browser during-acquisition p95 remain unmet**. This round removes avoidable
index-value/key copies, adds both requested mutation-sensitive regressions,
and measures the browser's synchronous work. A bulk-index prototype is faster
but exceeds the unchanged wasm budget and is not shipped. The Worker follow-up
is a concrete plan below, as permitted by the brief; no Worker is shipped.
Nothing was pushed or published.

## Orientation and preserved boundaries

First ran `git fetch origin && git merge origin/main`, fast-forwarding from
`2c333f30b` to `09e55ad98` without conflicts. Read the three binding prompts,
rounds 0–2 reports and journal entries, including the supervisor's corrected
round-2 durability description and sync card. Used `llp-orient` from the
populated sibling `lane-gs/vendor/llp` checkout: the local skill symlink is
uninitialized. No skill or tool was installed on a shared path.

Context pack: LLP 3000's Snapback 4 fence (foundation); LLP 2000.000's
replica/interpreter design; LLP 3000.007 §§18.2 and 20.4 (staged publication,
retention and web navigation/admission custody); LLP 3000.019 §§3.3/3.5
(current working set: watch publication and media homes); LLP 3000.016 §2.2
(read publication/prediction fences); LLP 3000.008.004 §3 (actual persistence
fault evidence), plus the current sync guide. Scope is index construction,
replacement undo, media-marker tests and the browser witness. Risks are
persistent key compatibility, undo ordering and confusing thread relocation
with a safe bypass of device read fences. No public contract or acquisition
protocol changes. Hand-off: none for landed code; the Worker plan remains
unimplemented follow-up, not a newly binding design.

The final code keeps one terminal publication, the same strict per-call host
save, staged crash recovery, current cap counts, key size validation, row
rules, expiry and meters. Node/native keep their existing openers; native
SQLite receives identical index bytes. Existing synchronous journal, orphan
adoption and exit-send code is unchanged. Rejected bulk code is absent.

## Before and after, two complete runs per host

Seconds; pairs are run 1, run 2, in order. These are shared-host observations,
not a latency distribution or proof of causality. All target-comparison runs
were serial within this lane, without CPU/JSON/IDB diagnostic instrumentation
or this lane's tests/builds running. Other lanes use this host concurrently.
Browser runs retain the same ordinary timers and long-task observer on both
sides. Raw pages, calls, saves, samples, heaps and hashes are retained in
[round3-measurements.json](./round3-measurements.json).

| 1,000 conversations, Node | Memory before | Memory after | IDB-shaped before | IDB-shaped after |
| --- | ---: | ---: | ---: | ---: |
| Acquisition total | 16.287, 16.617 | 15.689, 15.998 | 21.253, 21.373 | 21.132, 21.108 |
| Sync fetch through complete body | 2.998, 2.825 | 2.809, 2.991 | 2.872, 2.900 | 2.879, 2.909 |
| Snapshot staging apply, excluding saves | 2.988, 3.033 | 2.959, 3.036 | 2.942, 3.034 | 3.018, 2.997 |
| Terminal publication apply, excluding save | 8.450, 8.927 | 8.188, 8.137 | 9.192, 9.343 | 9.105, 8.976 |
| All persistence saves | 0.146, 0.153 | 0.139, 0.146 | 4.491, 4.447 | 4.458, 4.478 |
| — terminal save, part of preceding row | 0.088, 0.099 | 0.094, 0.100 | 1.660, 1.681 | 1.642, 1.669 |
| Other startup and host work | 1.704, 1.680 | 1.594, 1.688 | 1.754, 1.650 | 1.672, 1.748 |

Node cold runs contain no live writer, receive 110,088 rows in 13 responses,
and transfer about 41.96 MB of JSON each. Both Node witnesses remain unchanged.
The mean memory total falls 16.452 → 15.844 s (3.7%), and IDB-shaped total
21.313 → 21.120 s (0.9%). Terminal apply falls 8.688 → 8.163 s and
9.268 → 9.041 s, respectively. These modest gains do not approach the targets.

Real Chromium 151.0.7922.34, Playwright-core 1.55.1, real strict IndexedDB,
a fresh context/database for each run, live writer through acquisition:

| 1,000 conversations, Chromium | Before (1, 2) | After (1, 2) |
| --- | ---: | ---: |
| Acquisition total | 27.529, 27.080 | 28.445, 27.749 |
| Sync fetch through complete body | 3.752, 3.875 | 3.672, 3.815 |
| Snapshot staging apply, excluding saves | 3.077, 3.054 | 3.037, 3.050 |
| Terminal publication apply, excluding save | 7.098, 7.129 | 6.730, 6.603 |
| All persistence saves | 12.059, 11.454 | 13.488, 12.710 |
| — terminal save, part of preceding row | 5.107, 4.601 | 6.567, 6.010 |
| Other startup and host work | 1.542, 1.569 | 1.517, 1.572 |
| During-acquisition live p95 | 13.245, 12.723 | 14.393, 13.680 |
| During samples / timeouts, each run | 19 / 0, 19 / 0 | 19 / 0, 19 / 0 |
| After-acquisition live p95 | 0.844, 0.795 | 0.879, 0.868 |
| After samples / timeouts, each run | 20 / 0, 20 / 0 | 20 / 0, 20 / 0 |

Nearest-rank p95 includes timeouts as infinity; at 19 samples it is the
maximum. None timed out. Browser acquisition receives 110,972 events in
13 responses (about 42.18 MB), including repeated unread-count updates.
Node and browser are different workloads: the browser sends throughout
acquisition, then three warmups and twenty measured sends. Private fixture
writes change a few bytes between runs. Do not treat these as identical
static message traces or browser persistence as fake-IDB cost.

Browser terminal apply improves in both samples, while terminal persistence
is slower by about 1.4 s. Consequently total acquisition and during p95 are
worse in these samples. The separate diagnostic after run is faster than
both before diagnostic and normal after runs; that variability does not
justify discarding either slower normal run. There is no browser end-to-end
speedup claim. Network rows are client wall time, not isolated server CPU;
Node records response-header and body subdivisions per page. Apply includes
its JS wrapper and boundary work, with timed saves subtracted. The phase
rows excluding the indented subdivision sum to acquisition.

## Profiles and choice of implementation

The fresh preserved-baseline symbol-bearing Node/V8 profile
again located index insertion (3.198 s sampled CPU) and index construction
(2.177 s) above every other publication category. Staged decode was 0.386 s,
row writes 0.192 s and physical cap counts 0.011 s. Terminal staging has
validated/serialized rows, but has not built the live indexes. Merely moving
that work into a staged shadow would redistribute the pause, not remove it;
it additionally needs a shadow lifecycle for catch-up, retained rows,
prediction replay and reopen. That change is not included.

Tried a per-index vector of encoded entries, followed by `BTreeMap`
collection's sorted bulk construction. Cap counts remained immediate and
replacement kept the old `Undo::Entries` image; the equivalence/rollback
unit test passed. The single diagnostic candidate cold run was **13.635 s**
memory, versus the baseline's 16.287/16.617 s. But normal wasm was
**573,962 B gzip**, **1,121 B over** the unchanged 572,841 budget. A borrowed
encoding variant measured 13.530 s but 574,181 B gzip; outlining the encoding
helpers did not materially reduce it (574,180 B). These candidates were
removed. No over-budget artifact is the final or qualified artifact.

The selected smaller change borrows scalar column values for ordinary and
calendar index encoding, directly appends the id's existing encoding, and
moves the owned encoded key into the memory index. Contribution keys keep
their previous derived-value/expiry-sentinel path; word-index tokenization is
unchanged. `index_write` still constructs and validates each key before any
store mutation. This removes copies, not key validation or transaction work.
The final implementation does not avoid the retained row clone itself.

Repeated both symbol-bearing profiles serially after qualification. Sampled
index construction falls **2.112 → 1.900 s**, insertion **2.945 → 2.918 s**;
terminal call wall time is **7.534 → 7.189 s**. This supports the narrow
copy-removal attribution, not an end-to-end target claim. Staging remains
0.906/0.912 s sampled CPU. These diagnostic builds and sampler runs are
separate from the normal target timings above. The first after profile
overlapped targeted tests and inflated the run to 23.4 s; it is retained as
`after-memory-attribution-loaded` in the measurements, alongside the initial
baseline and the final isolated pair, and is not used as a speed comparison.

The browser diagnostic uses Chrome DevTools Protocol's CPU sampler, wrappers
around `WebDevice.call`/`drain`, JSON parse/stringify and real
`IDBObjectStore` put/get/delete, plus `PerformanceObserver` long tasks.
All metrics below are over the complete diagnostic witness, including warm
and after-acquisition sends; almost all cost is acquisition. JSON is grouped
by whether a persistence save is outstanding, so those intervals can include
small concurrent watch/transport JSON operations. The CPU stack separately
attributes bucket rewriting.

| Chromium diagnostic | Before | After |
| --- | ---: | ---: |
| Synchronous wasm apply wall time | 8.941 s | 8.405 s |
| Synchronous wasm drain wall time | 0.919 s | 0.934 s |
| JSON.stringify during save intervals | 2.213 s | 2.217 s |
| JSON.parse during save intervals | 1.506 s | 1.462 s |
| Synchronous IDB put issuance | 1.333 s | 1.326 s |
| IDB puts / gets / deletes | 20,009 / 4,757 / 13,384 | 20,017 / 4,758 / 13,389 |
| Largest main-thread long task | 7.124 s | 6.647 s |

Before, inclusive sampled `writeBucket` CPU is 6.924 s, including its JSON,
byte accounting and request issuance. The put timer includes synchronous
structured-clone/request work; it is not an isolated serialization or disk
measurement. Strict save time also includes request callbacks, scheduling,
GC and transaction completion. Do not add inclusive CPU to the wall timers.
The synchronous wasm task alone disproves sub-second delivery on this thread.
Moving IDB alone would leave it. Moving wasm alone leaves the several seconds
of bucket serialization work and the queued read-fence dependency below.

## Files and regression evidence

| File (relative to `snapback4/`) | Final change |
| --- | --- |
| `crates/snapback4-core/src/key.rs` | Reuse the existing scalar and id encoders without constructing an owned id `Value`. Wire/key bytes are unchanged. |
| `crates/snapback4-core/src/rows.rs` | Borrow ordinary columns while encoding; keep derived contribution path; test persisted composite-key bytes across missing/null, booleans, extreme integers, embedded NUL, Unicode, bytes, fallback values and offset calendar keys. |
| `crates/snapback4-device/src/memory.rs` | Move each validated encoded key into its index instead of cloning it. Undo, replacement and count code is unchanged. |
| `crates/snapback4-device/src/memory_tests.rs` | Overwrite an existing id, savepoint, insert a different row in a failing `replace_rows`, then drop the transaction; compare both entries and `export()` with pre-transaction state. |
| `crates/snapback4-device/tests/asset_lists.rs` | Use `photos = [[asset_a], []]`, verify nonempty marker/custody across reopen, clear and reopen empty, then reacquire, on memory and SQLite. |
| `witness/sync-scale-browser.mjs` | Optional CPU/wasm/JSON/physical-IDB instrumentation and main-thread long-task evidence; ordinary run behavior and live timeout accounting retained. |
| `reports/20260927-ss-sync-scale/ROUND3.md`, `round3-measurements.json`, qualification evidence | This report, both repetitions, profiles and controls. |
| `JOURNAL.md`, existing acquisition issue, new timeline and explicit-sync issues | One dated append, the still-open targets/Worker follow-up, and baseline failure tracking. Previous entries and the supervisor's corrections remain intact. |

Both requested mutation controls fail with exit 101. Replacing recursive
`any` with `values.last().is_some_and(...)` fails **both** sparse-marker
stores at the nonempty-marker assertion. A mutation that skips older
`Undo::Entry` records after restoring `Undo::Entries` fails at **“older index
undos survive restoration of the saved tree”**. Every temporary mutation is
restored before passing qualification. These deliberately red controls are
not unresolved failures. The existing scalar/index equivalence, prediction
savepoint and interrupted replacement assertions remain.

No new authoring form or diagnostic. Existing forms still compile and run:

```js
const client = await createLocalClient({ url, session, device: webDevice() });
const watch = client.observe({ kind: 'query', name: 'messaging.history' }, { conversation });
const stop = watch.subscribe(() => render(watch.getSnapshot()));
```

The scale witnesses exercise this API. The existing media declaration
`photos: [[image <=100] <=2] <=2 ?` accepts the mixed value above on both
stores. The whole guide is tested, not just these examples.

## Memory, durability and remaining limits

| Observed MiB, samples 1 and 2 | Before | After |
| --- | ---: | ---: |
| Node memory JS heap | 201.3, 198.0 | 198.7, 198.0 |
| Node memory external | 878.1, 861.9 | 916.9, 916.9 |
| Node IDB-shaped JS heap | 728.4, 724.4 | 723.9, 726.0 |
| Node IDB-shaped external | 877.6, 861.4 | 932.6, 916.3 |
| Chromium whole-run JS heap | 186.8, 357.3 | 186.4, 187.0 |
| Chromium wasm heap at end | 749.2, 733.0 | 788.1, 804.2 |

The changed allocation pattern has a **higher observed wasm/external
high-water mark**, despite fewer temporary key/value copies. This is a
material tradeoff, not a memory improvement claim. JS heap depends on GC
scheduling; the browser's second baseline is retained in the table. The
20 ms samples and call/save checkpoints cannot observe every transient
within a synchronous call. Browser JS heap does not include wasm linear
memory or IndexedDB's disk/browser-process storage. Fake-IDB retains
completed transaction history, as round 1 established. Independent retained
rows require Ω(rows) memory, so no sublinear total replica claim is possible
for this fixture. Nothing raises or evades a meter/budget to hide that cost.

The Chromium navigation/restart witness passes: **9,922 staged rows, zero
published rows, acquired=false** before destroying the realm; complete
acquisition after reopening the same real IndexedDB. Its run overlaps
qualification and is functional evidence only, not a third timing sample.
This tests navigation, not physical power loss. Existing real-IDB abort and
staged-page/failed-host-save tests remain in affected/full qualification;
a host-save exception is not represented as an interruption inside IDB.

Open problem and reproduction: all 1,000-conversation cold and during-live
targets above remain open in the existing acquisition ticket. Run the
memory, IDB and browser commands below. The synchronous terminal index work,
strict persistence and device-queued read fencing remain. A staged shadow
and a larger wasm budget were not introduced. The explicit deviations are
the unmet acquisition/live targets, the larger observed wasm high-water
allocation and the permitted Worker-plan-only outcome. No claim of improved
Chromium acquisition, sublinear memory, changed native performance or
finished Worker qualification is made.

## Qualification and wasm

Affected checks: device library **48/48**; device, asset-list, retained-history
and repair-B integrations **484 passed / 1 existing ignored**; core key tests
**5/5** and the new byte-equivalence test **1/1**; whole guide **86/86**;
affected SDK files **46/46**. Package build, final wasm build and the real
Chromium restart witness pass. Root reference audit: **517 LLP documents,
9,632 references, 27,345 files, 0 errors, 0 unchecked**. Whitespace check
passes. No edited source exceeds 1,500 lines (largest: `memory.rs`, 735).

Ran `SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh` **once**, exit **1**.
Exact summary: **`== 2 failure(s) in 1510 s`**. The script counts failing
phases; those are Rust and client tests, containing three test failures:

| Classification | Failed test | Evidence and disposition |
| --- | --- | --- |
| **Baseline** | `snapback4::timeline::lifecycle::activation_refuses_each_populated_event_or_edge_table` | `timeline/lifecycle.rs:32` requires `planned view`; merged-main `E_TIMELINE_ACTIVATE` now says `planned query from guide feeds`. |
| **Baseline** | `snapback4::timeline_adoption::redefinition_refuses_atomically_and_delivery_keeps_running` | `timeline_adoption.rs:203` requires `event identities` and `planned view`; merged-main `E_TIMELINE_REDEFINE` now describes `repost identities`, original post ids and `planned home query`. |
| **Baseline, scheduling-dependent** | `native: legacy bare id cannot retain bytes after real home revoke` | `asset-lists.test.mjs:237`, assertion `real home is gone`. Ten unmodified isolated repetitions pass on each binary. Holding a pre-revocation sync response makes a post-revocation `sync()` join that old round and reproduces this assertion on both the preserved main binary and the current binary. The full-suite trace does not capture its exact schedule; that mechanism is a reproduced explanation, not a traced fact about the failing run. |

The two timeline tests and diagnostic source are byte-identical to
`09e55ad98`; the obsolete wording was changed by the initial merge. The
client test, native bridge and `local.ts` also match main. The controlled
client replay uses only the existing fetch injection, holds a complete old
response and makes subsequent sync unavailable; no production assertion or
runtime code was changed to green the test. The asset-denial assertion after
the stale-row assertion was not reached in the failing full-suite case.
This remains a follow-up, not an asset-custody pass claim.

Rust: **3,909 passed / 2 failed / 24 ignored**. Main client group:
**2,644 passed / 1 failed / 10 skipped**; serial client models **78/78**;
fixture wrappers **9/9**. Builds, budgets, typechecks, release guard and all
other phases pass. No lane-owned or environmental failure remains in this
full-suite invocation. Discarded experiments and deliberate mutation reds
are separately recorded below. No second full-suite invocation was made.

Evidence: [qualification](./round3-qualification.json),
[complete compressed log](./round3-full-suite.log.gz),
[baseline controls and binary/source hashes](./round3-failure-controls.json),
and [controlled schedule patch](./round3-media-sync-control.patch).
Open tickets: [timeline wording](../../../issues/20260927-snapback4-timeline-diagnostic-tests-stale.md)
and [explicit sync joins an older round](../../../issues/20260927-snapback4-explicit-sync-joins-old-round.md).
The former lists the two targeted Cargo reproductions; the latter includes
the original single-test command and a disposable-copy patch reproduction.

Final normal wasm: **1,981,913 B raw / 572,786 B gzip**, versus
**1,981,590 / 572,590** before: **+323 raw / +196 gzip**, **55 B headroom**
under the unchanged **572,841 B** budget. SHA-256:
`ca1b5e4fa4848d95a218a332e505cdd128a021b1a604c9fae4f6241397972f3f`.
Before hash: `3874f6596171e57a4285f85ef45c87546473760bf939ac96914853787e12c62f`.
The symbol-bearing profiles use isolated, nonshipping wasm/glue pairs;
neither replaces the normal artifact used for target timings or qualification.

Experimental budget refusals are lane-owned, discarded candidates, including
one intermediate smaller candidate 49 B over before sharing the contribution
encoder path. The first two private-server launch commands used the wrong
relative binary path and exited 127; corrected before any measurements.
There was no new tool installation. The existing local Node/Bun wrappers
avoid the host's incompatible optional wasm-opt 108 through the supported
no-optimizer path, exactly as in earlier rounds.

## Reproduction

From `snapback4/`, reuse only the lane's private copies under
`target/lane-ss-evidence/scale` and `scale1000`; never serve or modify the GS
original. The measured release server is built at merged main and held
constant across before/after device runs. Serve the copies with
`target/release/snapback4 dev --replay --no-watch --port 49371` / `49372`
from the fixture directories using the appropriate absolute binary path.

```sh
export PATH=$PWD/target/lane-ss-evidence/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun install --frozen-lockfile
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49372 target/memory.json memory
SS_SAMPLES=0 node witness/sync-scale.mjs http://127.0.0.1:49372 target/idb.json idb
node witness/sync-scale-browser.mjs http://127.0.0.1:49372 target/browser.json
SS_PROFILE=1 node witness/sync-scale-browser.mjs http://127.0.0.1:49372 target/browser-profile.json
SS_CRASH=1 node witness/sync-scale-browser.mjs http://127.0.0.1:49371 target/browser-crash.json
```

Repeat normal commands with distinct output names. `SS_PROFILE=1` also
writes `OUTPUT.cpuprofile`; the ordinary Node witness is unchanged. Node
V8 profiles use the existing `witness/sync-profile.mjs` preload and
`sync-profile-summary.mjs`, Node 24.13.1, default 1,000 µs sampling:

```sh
CARGO_PROFILE_WASM_STRIP=false cargo build -p snapback4-device --no-default-features --features web --profile wasm --target wasm32-unknown-unknown
# wasm-bindgen --target web into diagnostic/packages/snapback4/src/wasm;
# copy BOTH matching wasm and glue into diagnostic/packages/snapback4/dist/wasm.
# Copy the built SDK/package.json and the unchanged Node witness/preload there too.
SS_SAMPLES=0 SS_PROFILE=target/profile node --cpu-prof --cpu-prof-dir=target \
  --cpu-prof-name=profile.cpuprofile --import ./diagnostic/witness/sync-profile.mjs \
  diagnostic/witness/sync-scale.mjs http://127.0.0.1:49372 target/profile-run.json memory
node witness/sync-profile-summary.mjs target/profile.cpuprofile target/profile.json target/attribution.json
```

Actual isolated diagnostic roots are `target/lane-ss-round2/diagnostic`
(before, preserved round-2 wasm) and `target/lane-ss-round3/diagnostic`
(after). Raw profiles, page logs, discarded experiments, mutation driver
and exact qualification logs are under `target/lane-ss-round3/`.
The committed measurements include both target runs for each mode and
profile/qualification summaries, with no credentials.

Affected commands, followed by exactly one complete suite invocation:

```sh
cargo test -p snapback4-device --lib
cargo test -p snapback4-device --test asset_lists --test retained_history --test repair_b_boundaries --test device
cargo test -p snapback4-core --lib key::tests
cargo test -p snapback4-core --lib rows::index_encoding_tests
cargo test -p snapback4-lang --test guide
node --test packages/snapback4/test/web-durability.test.mjs packages/snapback4/test/sync-scale.test.mjs packages/snapback4/test/web-review.test.mjs packages/snapback4/test/word-expansion.test.mjs packages/snapback4/test/maintained-columns.test.mjs
SNAPBACK4_RUST_TEST_PROCESSES=8 bash scripts/test.sh
```

Toolchain: Node 24.13.1, Bun 1.3.14, Rust 1.97.0, eight Cargo jobs, dev/test
debug information disabled, fd limit 65,536. `bun install --frozen-lockfile`
ran once this round. No version, ceiling, wasm budget or dependency changes.

### Worker decision and bounded follow-up

A dedicated Worker is the right execution location for the browser device:
wasm publication alone creates a multi-second main-thread task, and moving
only IndexedDB cannot remove it. Move wasm **and** bucket encoding/IDB to the
same Worker so the page does not receive the full publication delta. Keep
Node and native on their current openers and leave the wasm bytes/ABI alone.
This round stops at this plan, as the brief permits; no Worker is shipped.
The implementation is not safely a generic `postMessage` wrapper around
`webDevice()` for these concrete reasons:

* `AdmissionJournal.capture` writes localStorage synchronously before
  `mutate` returns its promise (LLP 3000.007 §20.4). Workers cannot perform
  that page-local operation. Moving the existing opener wholesale either
  refuses browser admissions or loses navigation custody. Capturing after a
  Worker round trip loses a write if navigation occurs before that reply.
* `onSuspend` synchronously journals an exit and executes `begin_send`
  before a keepalive send. Deferring its fence to a Worker could accept a
  snapshot captured before the send revision, or expose a write before its
  binding has been checked. The committed outbox mirror is necessary but
  does not by itself prove that a cached binding is still current.
* `evaluateLocal` awaits `query` and `queued` before a server request, then
  awaits `queued` again before publishing the reply. These calls serialize
  behind the same device chain as `apply`. A Worker alone therefore makes
  the page responsive while the server-answered watch still waits through
  terminal apply and its strict save. Skipping those calls without an
  equivalent fence could publish over a queued prediction.

Implement as one browser-only ownership protocol in a later round:

1. Keep the exclusive store claim and synchronous localStorage admission
   capture on the page. A Worker owns the VM and IndexedDB calls under that
   claim; the page is the only dispatcher. A failed Worker leaves the page
   claim held until outstanding persistence is resolved and the VM is
   restored from the durable store, or until closing. Never publish a
   partial call, and never release ownership to another tab while an old
   Worker can still write. Validate the termination/IDB ordering in Chromium.
   Preserve injected persistence providers without attempting to clone their
   functions through postMessage; qualify the default browser Worker path
   separately, with its instrumentation inside the Worker. Package its static
   entry/wasm URLs through the existing bundler path and test offline reopen.
2. Split journal capture/cleanup from execution. Transfer captured records
   with their original id/order/authority; keep the `j` transfer marker in
   the same strict IDB transaction as admission. Report durable replies
   before fallible cleanup; localStorage removal failure remains acknowledged
   by that marker. Preserve orphan lock/adoption, receipt retirement and
   identity checks, including crashes on either side of each message. Keep
   large row/change arrays inside the Worker; replies contain only ordinary
   operation results and small control metadata.
3. Publish a conservative page-side control snapshot after each durable call:
   store/generation, acquisition incarnation, prediction footprint (unknown
   stays blocking), queued-write revision and issued-time floor. Synchronous
   admission marks pending prediction authority *before* the Worker receives
   it. During cold acquisition only, let already server-answered watches
   use this control snapshot for both dispatch and delivery; preserve
   credential/store/expiry/revision fences, disable composition and held
   reads on this bypass, and retire it at publication. A Worker completion
   cannot clear a newer page-side admission fence. This is a new proof
   obligation, not an optimization to assume safe from a cached empty queue.
4. Separate exit preparation from dispatch. Establish binding and begin-send
   custody while ordinary calls run; at pagehide, synchronous page authority
   and journal checks may dispatch only a still-current prepared head.
   Otherwise retain it durably for reopen. Prove how this preserves the
   existing suspension behavior before replacing the synchronous VM call;
   do not ship a silently disabled exit path as a responsiveness fix.
5. Reuse web admission/session/navigation/orphan and durability tests through
   the Worker opener. Add crash points before capture transfer, during staged
   save, during terminal strict commit, after commit/before reply and during
   cleanup; a second tab must recover once, never adopt a live owner. Repeat
   the 503, queued-prediction and expiry watch cases while the Worker is
   deliberately busy. Chromium must show live server replies under one
   second p95 during terminal work, responsive page heartbeats, complete
   offline reopen and unchanged cross-tab journal recovery. Node/native
   qualification and the 572,841-byte wasm budget remain unchanged.

This work spans the browser ownership/journal boundary and the read
publication boundary. The required fault and cross-tab evidence does not fit
this round alongside the measured index work and required full qualification.
No claim is made that relocating CPU work alone meets the 8/12-second total
acquisition targets; total device/index and serialization work remains.
