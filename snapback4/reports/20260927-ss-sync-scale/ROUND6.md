# SS round 6 — Clique acquisition, atomic IDB deletion and honest limits

2026-09-28, `sb4-intent/ss-sync-at-scale`, expo-build-1000 (Linux x86_64,
96 logical CPUs). Local work only: no push, publication or integration. Implementation: `b300391f2`;
measurement correction and final qualification are committed separately.
First command was `git fetch origin && git merge origin/main`; already up
to date, with no conflicts. Round 5 remains unreviewed. This round does not
promote the Worker to the package default or claim independent review.

## Outcome

The requested real-app targets are met in both final Worker repetitions.
The default meets the acquisition deadlines but fails responsiveness.
These are two measurements of this workload, not an SLA or a broad browser
qualification. There is little margin below the central account's 30 s bar.

| Account / device | Fresh navigation → ready, s | Login submit → ready, s | Longest acquisition task, ms | Longest including page boot, ms |
| --- | ---: | ---: | ---: | ---: |
| `u0001`, default | 28.414 / 26.659 | 28.191 / 26.443 | 7479 / 6994 | 7479 / 6994 |
| `u0001`, Worker | **27.391 / 28.804** | 27.176 / 28.570 | **0 / 0** | **71 / 75** |
| `u0500`, default | 4.003 / 4.395 | 3.781 / 4.167 | 368 / 422 | 368 / 422 |
| `u0500`, Worker | **4.166 / 4.046** | 3.936 / 3.827 | **0 / 0** | **77 / 72** |

`0` means no Long Tasks API entry (50 ms threshold), not zero work. The
larger navigation-to-ready number includes the web bundle, UI login and
actual rendered `offline-access-status` text. Each run uses a fresh Chromium
151.0.7922.34 context and real IndexedDB. It is the builder's Expo/Metro web
export, not the synthetic SDK page. Final exports use the builder's existing
wasm transformer and Metro's ordinary Worker bundling, without a Worker URL
shim. Only the copied SDK is instrumented; `?worker=1` selects the option in
the copied app. All final runs have zero page errors and the same acquired
rows/response counts. The corrected repetitions overlapped the lane's full
suite on the shared host (6.28 load across 96 CPUs at the client phase); they
are not described as exclusive-host measurements. No independent live writer is added to this real-app
workload; the app's ordinary reads and background behavior remain active.
Round 5's synthetic live-writer and historical Node 8/12 s targets are not
remeasured or closed by this table.

Recommendation for this large-account workload: `webDevice({ worker: true })`.
Keep `webDevice()` as the package default pending independent review and
broader startup, memory and platform qualification. The Worker keeps the
same wasm, durability, page claim, synchronous journal and read fences.

## The supplied timeout is not reproduced on this host

Membership counts in a **private writable copy** of the verified store find
`u0001@example.com` / `user:01M3JWGZXWH8T1EEK25PGJPD01` in **1,000** conversations;
`u0500@example.com` has **100**. The store, WAL and app source supplied in
`rg-evidence` were read/copied only. No RG worktree was accessed or changed.

The first current-lane, instrumented default acquires in **29.181 s** from
login submission; the first Worker takes **29.543 s**. At 100 conversations
these are **4.128 / 3.902 s**. Those Worker runs used a temporary separately
bundled Worker asset; the final and matched controls use Metro directly.
A separately copied fixture served by the **published Linux 0.4.6 binary**,
with the **published 0.4.6 client/wasm**, acquires in **29.089 s** centrally
and **4.532 s** for `u0500`. These were reconstructed production exports,
not a claim to rerun the original Darwin binary. The supplied export did not
include its wasm asset in this evidence tree, so the published package was
installed under this worktree for that comparison.

The calibration record names **Darwin/arm64**, and records earlier high host
load. Its 90-second timeout remains valid evidence for that run. It is not
reproduced by the Linux copies, and this patch cannot claim to have fixed its
cause. In particular, the real partition is **110,000 events / 41.586 MB**, close
to the prior synthetic 110,088 / 41.958 MB. More public interaction summaries
alone do **not** establish a threefold volume or cost increase here. The real
central account has 90,500 acquired messages; `u0500` has only 500, despite
100 memberships. Conversation counts alone are not equivalent workloads.

## Volume and declarations

Lane-server measurements retain per-response `Server-Timing`, compact UTF-8 body bytes,
event counts, snapshot/continuation flags and per-table event bytes. A table's
response count means replies containing an event for that table; counts overlap.
Event bytes include each event envelope, excluding the enclosing page framing.
Wire totals include that framing. No login token or row content is recorded.
Here wire bytes means UTF-8 response-body bytes, excluding HTTP headers and
transport overhead.

| Table | Central rows / event bytes / responses | `u0500` rows / event bytes / responses |
| --- | ---: | ---: |
| conversations | 1000 / 292600 / 1 | 100 / 33400 / 1 |
| dms | 900 / 207000 / 1 | 0 / 0 / 0 |
| followingEdges | 5 / 1620 / 1 | 500 / 162000 / 1 |
| followingFeed | 439 / 209074 / 1 | 1000 / 478689 / 1 |
| followingWork | 40 / 19520 / 1 | 63 / 30744 / 1 |
| likes | 2000 / 512000 / 1 | 2000 / 512000 / 1 |
| members | 2048 / 551960 / 1 | 248 / 66860 / 1 |
| messages | 90500 / 35166891 / 10 | 500 / 197121 / 1 |
| ownLikes | 5008 / 1612576 / 2 | 5008 / 1612576 / 1 |
| ownReposts | 1004 / 321280 / 1 | 1004 / 321280 / 2 |
| posts | 1000 / 414000 / 1 | 1000 / 414000 / 1 |
| profiles | 1008 / 433425 / 1 | 1008 / 433425 / 1 |
| reactions | 2000 / 696500 / 1 | 2000 / 696500 / 1 |
| reposts | 1000 / 312000 / 1 | 1000 / 312000 / 1 |
| unread | 2048 / 458654 / 1 | 248 / 55454 / 1 |
| **Wire total** | **110000 / 41586226 / 13** | **15679 / 5370728 / 3** |

Central messages dominate bytes: `sync to members[.conversation] last 500 by
byHistory` applies **per conversation**. Whole authorized member, conversation,
DM and reaction groups add their rows; the maintained unread view inherits its
member audience. The public profiles/posts/likes/reposts horizons and reader
Following partition account for the remaining bounded source rows.

The two declarations `view ownLikes: count likes by .principal, .post` and
`view ownReposts: count reposts by .actor, .post` inherit **public** sync.
Their names and lookup with `viewer` do not narrow that audience; their sources'
horizons do not bound these complete maintained key sets. They deliver **6,012
rows / 1,933,856 event bytes to both accounts**. This is a particularly large
share of `u0500`'s 5.37 MB partition. It is what the app declared, not redundant
Snapback delivery. App declarations were not changed to meet the deadlines.

`check --json` already emits **N_MAINTAIN_SYNCED**, naming both views, each
public inherited audience, every-device delivery, and the `online only`
tradeoff. The record is [round6-check-before.json](./round6-check-before.json).
The guide lacked a sufficiently direct cold-start sizing procedure. Its new
section explains group-count multiplication, query page versus acquisition,
source horizons versus maintained views, warning suppression, representative
largest-account measurement, and the offline consequence of `online only`.
No new diagnostic or language spelling was needed.

## Attribution and fixes

Initial current-lane server response totals are **2.811 / 2.854 s** centrally
(default/Worker), and **0.427 / 0.435 s** at 100. These are server time through
header construction, including engine and response preparation; the raw records
also separate wait, engine and CPU. The central unread-only page spends about
**1.57 s** in the server engine. It certifies 2,048 unread values against their
live expiring source; count delivery already uses round 0's bounded batch path.
There is no new server count cache, authorization shortcut or device-wide recount
on each apply. The existing scalar/batch equivalence and metering witness is
rerun. This page's whole engine time is an upper bound on certification, not a
falsely isolated timer for just its aggregate loop.
The server's `certify_batch`/`certify_group` run in delivery; neither appears
in the sampled device call stacks. Absence from a sampled profile is not a
zero-millisecond timing claim.

Initial synchronous wasm `apply` totals are **8.518 / 8.521 s** centrally and
about **0.48 s** for `u0500`. At 1,000, staging is roughly **2.3 s** and terminal
publication **6.2 s**. Main-thread publication thus remains too long on the
default device. No Rust code or wasm ABI change is included in this round.

Final phase totals, seconds (first / second repetition):

| Account / device | Server total | Device apply | Terminal publication within apply | Strict IDB saves |
| --- | ---: | ---: | ---: | ---: |
| `u0001`, default | 2.887 / 2.850 | 8.753 / 8.660 | 6.473 / 6.324 | 12.539 / 11.301 |
| `u0001`, worker | 2.921 / 2.854 | 8.962 / 8.552 | 6.486 / 6.295 | 10.064 / 11.314 |
| `u0500`, default | 0.432 / 0.503 | 0.480 / 0.551 | 0.282 / 0.316 | 1.794 / 2.092 |
| `u0500`, worker | 0.433 / 0.463 | 0.481 / 0.534 | 0.285 / 0.291 | 1.555 / 1.448 |

These spans describe separate phases, not a replacement for the browser's
end-to-end clock. Certification is included in the unread page's engine time;
physical device cap counting is separately visible in the CPU diagnostic below.

The real-app symbol-bearing Chromium CPU diagnostic attributes exclusive sampled
work as follows (diagnostic instrumentation is excluded from deadline claims):

| Category | Sampled CPU, s |
| --- | ---: |
| Index construction / insertion | 1.648 / 2.415 |
| Command decode and validation | 1.283 |
| Commit/change encoding / drain encoding | 0.969 / 0.666 |
| Staging / coverage / staged row decode | 0.906 / 0.383 / 0.362 |
| Remaining publication / row writes | 0.679 / 0.188 |
| Media markers / physical cap counts | 0.159 / 0.004 |

JS JSON instrumentation totals 1.525 s stringify and 1.521 s parse. These and
inclusive stack costs overlap other categories and must not be added to total
wall time. The IDB diagnostic records **629 transactions (145 readwrite),
20,803 puts, 1,047 delete requests including one range delete**, and **636.879 MB
of serialized put records**. Of that, staged namespace puts are 555.446 MB and
live rows 70.306 MB. These are logical serialized request bytes, not filesystem
write bytes, compressed disk size or unique data. The symbol-bearing wasm cache
is also larger than shipping wasm. Rewriting bounded bucket contents across
successive pages remains substantial amplification.

Two persistence fixes keep the existing on-disk format, bucket caps and strict
per-call transaction:

1. **Proved range deletion.** When at least 512 unique keys in a row namespace
   are deleted and there are no puts in that namespace, read at most deletion
   count + 1 physical keys in the same transaction. Only if every existing key
   is in the deletion set replace individual overflow deletes with one range
   delete. A survivor or incomplete proof retains scalar deletes. Packed bucket
   records still receive their normal individual updates. Work is bounded by
   the input delta, not by an unrelated store's size. Metadata, live rows,
   outbox and stage removal retain one abort/commit boundary.
2. **Deletion needs no capacity calculation.** A bucket receiving only deletes
   removes them without JSON-encoding each discarded image to subtract its old
   byte size. Mixed deltas retain the existing exact UTF-8 capacity accounting.
   Spill behavior, later updates, migration from format 1 and format-2 reopening
   remain intact.

The first range-only trial reduced central terminal save **5.436 → 2.683 s**
and readiness **29.543 → 27.718 s**. Matched Metro controls provide the more
conservative end-to-end comparison below. Do not substitute the larger initial
improvement for these controls.

| Worker / central, two runs | Before | Final |
| --- | ---: | ---: |
| Fresh navigation → ready, s | 28.630 / 28.664 | 27.391 / 28.804 |
| Login submit → ready, s | 28.400 / 28.452 | 27.176 / 28.570 |
| All strict save time, s | 11.488 / 11.228 | 10.064 / 11.314 |
| Largest terminal save, s | 3.742 / 3.986 | 2.757 / 3.361 |
| Apply time, s | 8.435 / 8.742 | 8.962 / 8.552 |

Terminal save improves in both final samples, but **overall acquisition is
roughly unchanged** within this small sample's variation; no large total-speedup
claim is warranted. The 100-account matched Worker control is 4.163 s from
navigation, versus final 4.166/4.046 s, also roughly unchanged.
All final per-phase data, including the default device, are in
[round6-final-summary.json](./round6-final-summary.json).

### Rejected candidates and wasm

- A sorted bulk-index prototype builds to **2,027,604 B raw / 587,102 B gzip**:
  **+7,789 / +1,718 B** versus baseline, **909 B over** the unchanged 586,193 B
  gzip budget. The build correctly refuses it; it is removed before qualification.
  No real-app speed claim is made for that rejected build.
- Increasing bucket fanout from 256 to 1,024 worsens the Worker central run to
  **69.207 s**, with **52.021 s** of saves; `u0500` takes **6.454 s**. Rejected.
- Structured bucket values instead of JSON strings give **29.597 / 3.877 s**
  centrally / at 100, no meaningful central improvement over 29.543 s. Rejected;
  no new persistence format or migration is shipped.

Final canonical wasm is **2,019,815 B raw / 585,384 B gzip**, SHA-256
`083297984d5d963d3d356ac1fb73fb4b05c3239f7a25ac6c69bc05f50185f625`.
Delta **0 / 0 B**, unchanged cap **586,193 B**, headroom **809 B**. The
symbol-bearing diagnostic artifact is separate and never the shipping artifact.
The budget file, public device contract, native device and wasm ABI are unchanged.

## Files, forms and regression evidence

Paths relative to `snapback4/` unless prefixed `../`:

| File | Result |
| --- | --- |
| `packages/snapback4/src/web-idb.ts` | Bounded proof and atomic physical range deletion; existing scalar path on mixed/partial deltas. |
| `packages/snapback4/src/web-idb-buckets.ts` | Avoid removed-image re-encoding; skip scalar overflow deletes only after the range proof. |
| `packages/snapback4/test/web-review.test.mjs` | Browser regression for abort/rollback, range request count, bounded probe, no image encoding, duplicates/nonexistent keys, unmatched survivors, mixed inserts and reopen; mutation controls remain active. |
| `witness/clique-scale-browser.mjs` | Fresh real-app login/readiness timing, table volume, server headers, page long tasks, optional CDP CPU profile and Worker-realm telemetry. |
| `witness/clique-scale-instrument.mjs` | Instruments only a private copied SDK/app; supports current and published 0.4.6 layouts, optional IDB/JSON diagnostics, normal Metro Worker export. |
| `crates/snapback4-lang/src/guide/sync.rs` | Cold-account sizing and explicit maintained-view tradeoffs; measured Worker recommendation and limitations. |
| `../llp/3000.007-relaxed-quarry-and-explicit-residency.rfc.md` | §20.4 records the bounded deletion proof and unchanged publication boundary. |
| `../issues/20260927-snapback4-1000-conversation-acquisition-budget.md` | Real-app progress while retaining historical Node/live targets and review. |
| `JOURNAL.md` and `reports/20260927-ss-sync-scale/round6-*` | Append-only round result, raw measurement records, profiles and qualification logs. |

Existing forms compile and run, with no new syntax or diagnostics:

```js
webDevice();                    // unchanged default semantics
webDevice({ worker: true });    // same round-5 option, now measured on Clique
```

```quarry
view ownLikes: count likes by .principal, .post
```

That view continues to inherit its source audience. Adding `online only` is
existing syntax and intentionally changes its offline availability; the measured
app is not rewritten to use it. `snapback4 check --residency --verbose` remains
the sizing/diagnostic form described by the card.

The new browser regression aborts at the actual range delete and proves that
rows, stage, watermark and outbox all reopen unchanged. A successful repetition
requires one range delete, no per-key stage deletion, and zero old-image
encodings; it then checks partial deletion with duplicate and nonexistent keys,
an unmatched survivor and a mixed delete/insert. Removing the survivor-membership
proof fails it; removing overflow deletion fails existing and new assertions.
These negative controls are expected failures, not qualification reds.

## Qualification and failure accounting

Affected checks pass: **192/192 web and clock tests**, including the 18 Worker
controls and the new publication regression; **5/5 sync-scale tests**; **36/36
Worker protocol cases** with zero page errors; **3/3 busy-Worker watch cases**;
navigation **10/10 default and 10/10 Worker**; **13/13 memory/index tests**;
the count-batch equivalence/meter test; and the **whole guide, 92/92**. Typecheck,
package build, canonical wasm build and witness syntax checks pass. Every
modified source is below 1,500 lines. The reference audit reports
`ref-check: ok — 521 LLP docs, 9755 refs in 27790 files, 0 errors, 0 unchecked`.

Failures outside the complete suite, all retained and classified:

- **Baseline:** the default and Worker IDB witnesses each exit 1 solely on
  `durability.adoptionRejected: false` and `durability.adoptionUnlocked: false`.
  The witness assumes eager orphan recovery in `open`; current recovery waits
  for the first call/authority attach. Round 4 already reproduced these on
  main. All other witness assertions hold and there are zero page errors.
  See `issues/20260928-snapback4-idb-witness-assumes-eager-orphan-recovery.md`.
- **Ours, intentional negative controls:** removing the physical survivor
  check fails the new regression (8 pass / 2 fail including its parent);
  removing overflow deletion fails old and new assertions (7 pass / 3 fail
  including the parent). Unmodified code passes all 10 tests in this file.
- **Ours, rejected prototype:** the sorted bulk-index wasm build exits 1 at
  909 bytes over budget. The prototype was removed; the final build passes
  without changing the budget.
- **Ours, corrected measurement setup:** early private Metro exports failed
  to resolve the temporary `/ss-worker.js` URL and an incomplete SDK copy's
  `snapback4/react`; normal Metro bundling and a full SDK copy correct both.
  Temporary path/hook mistakes were corrected before qualification. Final
  audit also caught an export targeting the published server rather than the
  lane server. Those eight runs are retained as `published-server-final-*`
  (central Worker 27.592/29.276 s, small 4.229/4.232 s, worst task 83 ms),
  including their absent `Server-Timing` headers. The corrected runs use the
  same lane server as the paired controls; the witness now records and asserts
  the expected server origin. They replace no failed deadline sample.
- **Environmental:** the supplied export lacks its wasm asset in this evidence
  tree, so fresh exports were built in private copies. No remaining test
  failure is attributed to the environment.

Ran `scripts/test.sh` **exactly once**: **`== 0 failure(s) in 1349 s`**, exit 0.
Rust **4,162 passed / 30 ignored**; client shards **3,920 passed / 10 skipped**;
serial models **79/79**; fixture wrappers **9/9**. Every build, typecheck,
docs-budget, release guard and complete-suite stage passes. **No full-suite
failures** to classify. The inherited 60 s suite time budget remains unmet
(**baseline performance limitation**, also present in rounds 4 and 5).

The runtime implementation did not change during the run. The later witness
origin assertion was exercised by eight fresh real-app runs; the guide's
corrected measurement text passed a subsequent complete 92-test guide run.
The invocation used Node 24.13.1, eight Cargo build jobs, eight Rust test
processes and `ulimit -n 65536`, with the worktree-local PATH in the reproduction commands. Complete
output: [round6-full-suite.log.gz](./round6-full-suite.log.gz). Structured
exits, summaries and failure classes: [round6-qualification.json](./round6-qualification.json).

## Reproduction and boundaries

Affected-scope `llp-orient` context: the Snapback 4 fence and LLP 3000 govern
scope; LLP 2000.000 §7 governs declared partition volume; LLP 3000.007 §§18.2
and 20.4 govern atomic staged publication and web custody; LLP 3000.008.004 §3
requires actual persistence-fault/reopen evidence; LLP 3000.016 §2.2 and
3000.019 §3.3 retain read/prediction fences; LLP 3000.022 §4 retains the
commit-point conditional delivery check. The 3000 root, .007, .019 and .022
are in the current working set; no separate Snapback 4 foundation link was
present. Scope is IDB execution and guidance, not a new sync protocol. The
risks are deleting an unmatched durable key or publishing before strict commit;
the browser regression exercises both. The existing .007 decision record is
updated; no new LLP or hand-off is needed. The skill was read from the populated
`lane-gs/vendor/llp` checkout, read-only, because this lane's mirror is absent.

All package/tool installation is inside this worktree's `snapback4/target/`
(or its own workspace dependencies); shared paths and fleet worktrees are not
modified. Original evidence is never served. Use Node 24.13.1, Bun 1.3.14,
Rust 1.97.0, existing Chromium, and the local PATH used by prior rounds:

```sh
cd snapback4
export PATH=$PWD/target/lane-ss-round4/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
export CARGO_BUILD_JOBS=8 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0
ulimit -n 65536
bun install --frozen-lockfile
bun run --cwd packages/snapback4 build
# Copy rg-evidence/lane to target/lane-ss-round6/app with cp -a --reflink=auto.
# Make ONLY that copied scale-instance writable; npm ci in the copied app.
# Serve its scale-instance with target/release/snapback4 dev --port 0 --no-watch.
node witness/clique-scale-instrument.mjs target/lane-ss-round6/app
# In the copied app, set EXPO_PUBLIC_SNAPBACK_URL to the private server URL:
# node node_modules/expo/bin/cli export -p web --output-dir dist-final --max-workers 4
SS_EXPECT_SERVER=http://127.0.0.1:PORT node witness/clique-scale-browser.mjs target/lane-ss-round6/app/dist-final target/central-worker.json u0001 worker
SS_EXPECT_SERVER=http://127.0.0.1:PORT node witness/clique-scale-browser.mjs target/lane-ss-round6/app/dist-final target/central-default.json u0001 default
# Repeat each condition twice; use u0500 for the 100-conversation condition.
```

For attribution, build an isolated symbol-bearing wasm/glue pair using
`CARGO_PROFILE_WASM_STRIP=false cargo build -p snapback4-device --no-default-features
--features web --profile wasm --target wasm32-unknown-unknown` and `wasm-bindgen
--target web`. Put **both matching files** into a copied SDK, then use
`SS_IDB_PROFILE=1 node witness/clique-scale-instrument.mjs COPIED_APP COPIED_SDK_DIST`,
Expo `--no-minify`, and `SS_PROFILE=1` on the browser witness. The retained
profile and [attribution](./round6-diagnostic-attribution.json) distinguish this
slower observer run from deadline samples. `sync-profile-summary.mjs` consumes
its wasm-call and transaction arrays; no interpreter fork or profiling ABI is used.

Open limits: the 90 s Darwin timeout needs its original host/conditions to
reproduce; the Worker still awaits independent review; index bulk construction
needs a within-budget implementation or an author decision; bounded buckets
still rewrite hundreds of MB of serialized records; original Node acquisition
and synthetic live-writer targets remain in the existing ticket. The default
main-thread pause reproduces with the default command above. Worker total memory
and a broad bundler/browser matrix are not established by page-heap sampling.

For the two baseline IDB expectations, run `node witness/idb.mjs` and
`SS_WORKER=1 node witness/idb.mjs`. For the older, different acceptance workload,
serve a private synthetic copy as described in [ROUND5](./ROUND5.md), then run
`SS_SAMPLES=0 node witness/sync-scale.mjs PRIVATE_URL target/node.json memory`
for Node acquisition, or
`SS_WORKER=1 node witness/sync-scale-browser.mjs PRIVATE_URL target/live.json`
for live-writer acquisition. The CPU/IDB diagnostic commands above reproduce
the remaining index and bucket costs. Independent review is a pending process,
not a performance result that this lane can self-certify.
