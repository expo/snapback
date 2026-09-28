# Lane RG — receipts at scale

## Round 5 — 2026-09-28

Merged main e0568c2ec7 without conflicts. Repeated media failure now schedules
bounded retry and continues through the outbox. New independent coverage pins
the observation catch's retry. The housekeeping audit also reproduced and fixed
post-commit admission and receipt-save failures that could prevent dispatch.
Round 4's notification ownership remains unchanged.

Final checks: **640 client and 135 Rust tests pass**, including the **58-test
audit** and **93-test whole guide**. Two client skips and one opt-in Rust
measurement remain explicit. All five round-4 and six round-5 mutation controls
are killed. Expected regression/mutation failures and corrected fixture/setup
failures are ours; no baseline or environmental check failure.

Wasm is unchanged: **2,019,815 B raw / 585,381 B gzip**, **812 B** under budget.
[Round-5 report, full housekeeping audit and failure record](round5/REPORT.md) ·
[final test counts](round5/test-summary.json) · [controls](round5/controls.json).
Did not run scripts/test.sh. No tools installed, push or publication.

## Round 4 — 2026-09-28

Merged origin/main in 412c9191c, retaining both lanes. Terminal emission
markers now survive replacement, qualified-success retirement and older FIFO
snapshots, with reference-counted ownership released in finally. Both Astra
reproductions fail before the fix; the audit found and fixed a third snapshot
race. The new pre-dispatch recovery test kills the surviving raw-call mutation.

Final checks: **552 client tests**, including the **54-test audit** and
**55-test browser admission suite**, plus **135 Rust tests** including the
**93-test whole guide**, pass. One legacy-server client check is skipped and
one opt-in Rust measurement ignored. Two initial guide failures were ours,
corrected and verified by the whole-guide rerun. All expected failing controls
and setup errors are classified in the report; no baseline or environmental
check failure. Wasm is byte-identical: **2,019,815 B raw / 585,381 B gzip**,
**812 B** under budget.

[Round-4 report and exactly-once audit](round4/REPORT.md) ·
[test counts](round4/test-summary.json) · [mutation controls](round4/controls.json).
Did not run scripts/test.sh. No installs, push or publication.

## Round 3 — 2026-09-28

Fetched and merged origin/main first (already up to date). Durable terminal
notifications now survive failed observation reads and post-commit host/media
work. Added the independent final-loop-sync retirement regression and audited
all terminal delivery awaits. Receipt repair also retains its notification
marker until settlement finishes, preventing duplicate refusals.

Final affected checks pass: **243 Rust and 596 client tests**, including the
**93-test whole guide**, **42-test outbox file** and **55 browser admission
tests**. Wasm is unchanged: **2,019,815 B raw / 585,381 B gzip**, **812 B**
under the unchanged budget.

The single full-suite summary is **`== 1 failure(s) in 4162 s`** (`client tests`).
Six leaf failures, all ours: two maintained-column publication assumptions,
two pending-ID recovery assumptions, one stale cost-text assertion and one
duplicate refusal notification. The web-admission parent also fails. All were
corrected and verified in affected reruns; the full run remains red in the
record. All 79 model tests and every other stage passed.

[Round-3 report, complete audit and every failure](round3/REPORT.md) ·
[full-suite record](round3/full-suite.log) · [test counts](round3/test-summary.json).
No tools installed, push or publication.

## Round 2 — 2026-09-28

Merged `origin/main` (`a745b110f`) first, without conflicts. Unobserved successful
writes now drain before retry exits and after the FIFO loop; the refused-tail
regression holds publication before batch completion. Independent small-range
oracles and the Chromium witness reject removal of the full predicate.

The strengthened generated witness passes **72 unread checks**, with **380 ms
send/settlement p95**, **253 ms render p95** and **847 ms receipt convergence
p95**. Final affected checks pass: **255 Rust tests**, including the **93-test
whole guide**, and **479 client tests**; one opt-in Rust measurement is ignored.
Wasm remains **2,019,815 B raw / 585,381 B gzip**, **812 B** under budget.

The unmigrated run establishes a **30-second miss**, not an `E_BOUND` refusal;
the earlier screenshot attribution is withdrawn below and in the round-1
report. The corrected cost sentence describes the bounded predicate-index
candidates, including expired rows, and the shared expiry-walk fallback, with
the same one-examined/one-step public reservation.

[Round-2 report, controls and every failure](round2/REPORT.md) ·
[measurements](round2/witness-summary.json) · [test counts](round2/test-summary.json).
`scripts/test.sh` was not run. Nothing was pushed or published.

## Round 1 — 2026-09-28

Merged `origin/main` (`0a5596c2c`) first, without conflicts. The probe's charged
work now reduces the fallback recount allowance; all reported moderate/default
budget cases commit and settle private recounts correctly. Added independent
63/64/65-candidate tests, and fixed the late Grok finding where a refused tail
left an earlier successful write unobserved. The receipts and cost guidance
now describe the implementation and the full app migration.

The final fresh-store probe with that complete migration records **704 ms
send/settlement p95**, **73 ms visible-render p95**, **3.414 s receipt convergence
p95**, and **7.698 s cold ready**. All 20 measured sends are below one second;
maximum 925 ms. The first repeat using the retained round-0 app patch missed
at 1.146 s p95. It exposed a still-mounted `progress` read; its measurements
and higher host-load trace are retained, and no causal claim attributes the
entire difference to the migration alone.

Final checks pass: 254 Rust tests including the 93-test whole guide, and
478 client tests; one opt-in Rust measurement is ignored. Wasm is **2,019,815 B
raw / 585,381 B gzip**, 812 B under the unchanged budget and 3 gzip bytes
smaller than round 0. `scripts/test.sh` was not run in this round.

[Round-1 report, every failure and its disposition](round1/REPORT.md) ·
[measurements](round1/fixed-guide-measurements.json) ·
[complete builder migration](round1/complete-builder-migration.patch).
Nothing was pushed or published.

## Round 0 — retained record

2026-09-28. Starting main: `1972112a0`. Branch:
`sb4-intent/rg-receipts-at-scale`. `git fetch origin && git merge origin/main`
completed first, with “Already up to date.” Nothing was pushed or published.

The final full-corpus run meets the requested **<1 s p95**, using the builder's
timer: **913 ms**. Visible rendering alone is **59 ms p95**. All 49 peers'
read receipts converge in **3.73 s p95**. This result requires migrating the
builder's old receipt hook to the current SDK reporting form; it is not a
claim that an SDK replacement makes its history-walking hook inexpensive.
The exact measured app patch is [builder-guide-migration.patch](builder-guide-migration.patch).

## Reproduction and measurements

All servers ran on independent copies under `snapback4/target/rg/`, including
the SQLite WAL and assets. The original evidence tree was never written.
[original-store.sha256](original-store.sha256) was checked again after the
runs: both original database and WAL hashes match. No fixture credentials
are included here. Installs used the copied app and worktree-local npm cache.

Published means the installed npm `snapback4@0.4.6` client and Linux binary.
Main means the starting commit's production binary, locally built wasm and
client. The package version on that source is also 0.4.6; distinguish the
artifacts by [digests.txt](digests.txt), not the version string. Production
builds used `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`. Chromium was
the existing Playwright Chromium 1234 on this Linux x86_64 host (AMD EPYC
9454, 96 logical CPUs); Node was 24.13.1.

The archived web export lacked its wasm asset and initially received HTML
where a wasm module was expected. Each copied app was therefore rebuilt with
the builder's Expo web-export command and its own backend URL. This setup
failure preceded login and is not a product latency result.

Each completed run follows the builder's original 3 warmups + 20 samples,
49 authenticated peers, u0500, 100 conversations, and the exact 10,000-message
initial group. Peers read the message before reporting delivered and seen.
The builder chooses sorted sample index 18 as p95; this report does too.
Measurement JSON preserves its original `pass` field for the 30-second
assertion; `oneSecondTargetPass` records the stricter target.

| Measure | Published 0.4.6 | Starting main | Fix + guide migration |
|---|---:|---:|---:|
| Cold web ready | 5.397 s | 5.318 s | 5.892 s |
| Warmup 1 send/settlement | 0.840 s | 1.469 s | 1.222 s |
| Warmup 1 receipt convergence | 20.226 s | 16.368 s | 5.024 s |
| Warmup 2 send/settlement | 26.688 s | 13.221 s | 0.507 s |
| Warmup 3 send/settlement | 22.418 s | 13.273 s | 0.988 s |
| Measured send/settlement p95 | 15.596 s | 9.275 s | **0.913 s** |
| Measured visible-render p95 | 64.5 ms | 63.2 ms | **58.7 ms** |
| Measured read convergence p95 | 25.080 s | 18.203 s | **3.733 s** |

The three warmups remain excluded, including the final run's first settlement
over 1 s. The largest measured send was 1.020 s; 19 of 20 were below 1 s.
The unchanged baselines passed the builder's 30-second
assertion on this host but fail the requested 1-second target. We reproduced
the stall shape, not the exact 38.6-second duration from calibration #24.
The supplied `scale-receipt-probe-5.log` contains the cited 14.060 / 0.863 /
21.409 / 38.596-second sequence. Its later `scale-receipt-render.json` records
a different failed attempt, so the log and JSON must not be treated as one run.

The earlier implementation was not consistently below the target. A run
while the full suite and generated Chromium witness overlapped measured
1.106 s p95 ([loaded run](fixed-loaded-measurements.json)); the isolated
repeat measured 1.532 s ([before media](before-media-measurements.json)).
Skipping redundant media checks alone measured 2.731 s
([media-only run](media-only-measurements.json)). These are retained misses,
not discarded samples. These intermediate misses are **ours** (incomplete
fixes); the published/main target misses are **baseline**. They exposed the
remaining intermediate-sync wait
and motivated the final shared-settlement change. The earlier 587 ms run
alone was not sufficient evidence of a reliable fix.

Individual samples and warmups: [published](published-measurements.json),
[main](main-measurements.json), [fixed](fixed-guide-measurements.json).
Corresponding `*-probe.log`, `*-network.json.gz` and `*.cpuprofile.gz` retain
the timing observations. Decompress a CPU profile and load it in Chromium
DevTools' JavaScript profiler. Network records contain timings and counts,
not authorization headers or response bodies. Text logs only normalize trailing
whitespace; their result lines and failure messages are preserved.

## Where the delay occurs

The builder's `sendRenderMs` is measured **after both** the bubble becomes
visible and an independent owner client finds the message on the server.
The bubble itself already appeared quickly in both baselines. The large
number is chiefly delayed submission/settlement, not a frozen DOM.

**Wire amplification is bounded here.** Every complete run received exactly
523 message events: the initial 500-message horizon plus 23 sends. A receipt
did not re-deliver the 10,000-message history. An additional isolated test
advanced just one peer after the full runs, capturing the sender's next
stream response at the preceding head. All events belonged to that receipt's
commit; see [wire-receipts.json](wire-receipts.json):

| Receipt | Rows/events delivered | Complete JSON body | Main engine | Fixed engine |
|---|---|---:|---:|---:|
| delivered | run delete + run insert | 533 B | 16.321 ms | 17.387 ms |
| seen | member + unread | 715 B | 110.105 ms | 19.895 ms |

These byte counts include the sync envelope; event payloads are respectively
340 B and 522 B before array separators. Published response wall times were
24.80 and 145.61 ms. Published 0.4.6 emits no `Server-Timing`, so there is no
honest per-response split between its server execution and transport wait.
Its saved response times are upper bounds, not invented CPU measurements.

Across each full run, p95 browser response time / server engine time:

| Route | Published response | Main response / engine | Fixed response / engine |
|---|---:|---:|---:|
| `/sync` | 892.6 ms | 295.2 / 291.9 ms | 83.6 / 56.4 ms |
| `/changes` | 92.8 ms | 31.9 / 1.28 ms | 19.6 / 3.74 ms |
| `/m/send` | 10.7 ms | 10.0 / 5.96 ms | 17.9 / 9.89 ms |

`/changes` includes held-poll waiting; it carries invalidation, not historical
rows. Server timing records preserve total, acquisition wait, engine and CPU
for every response on main/fixed. The final run was isolated from this lane's
suite and other Chromium witnesses. Total wire bytes are not a clean receipt
comparison: the copied store
also contains pending following-feed maintenance. Final sync sent more feed
rows than the longer baselines. Table counts expose that confound rather
than attributing it to receipt delivery.

**Server recomputation did depend on history.** Main's live unread
certification walked the source's live expiry ranges even when the unread
ordinal suffix was empty or held one position. Lane SS already shared the
walk across members within one batch; a later receipt still triggered another
walk. The new Rust regression starts with 10,000 messages and checks 50 peers:
zero decoded source rows at the head, one decoded row one position behind.
Without the fix its first receipt decoded all 10,000 rows. A large/nonselective
range still uses the existing shared live walk, rather than 50 separate walks.

**Browser amplification was substantial.** The old clock persisted identical
offset metadata before each read. Each `usePendingWrites` row hook subscribed
and read the entire pending list independently, including its IndexedDB
receipt-history lookups. Receipt notifications repeatedly invoked both paths.

| Post-navigation browser work, complete run | Published | Main | Fix + migration |
|---|---:|---:|---:|
| IndexedDB transactions | 577,562 | 415,689 | 80,149 |
| IndexedDB write transactions / saves | 47,278 | 34,662 | 631 |
| `queued` SDK calls | not separately instrumented | 42,957 | 2,519 |
| History query evaluations | not separately instrumented | 2,262 | 230 |
| Receipt query evaluations | not separately instrumented | 785 | 230 |
| Reaction query evaluations | not separately instrumented | 15,189 | 4,669 |
| DOM mutation records | 25,729 | 16,754 | 4,217 |

The main device's wasm `apply` calls consumed 154 ms altogether; the final
run's consumed 299 ms, with a maximum of 12.2 ms. Final receipt-query wasm
evaluation consumed 5.71 s over 230 calls (maximum 48.9 ms), versus 14.89 s
over 785 calls on main. The larger asynchronous apply timings include
persistence and queueing: final 48 calls consumed 12.57 s summed, whereas
the synchronous wasm portion was 299 ms. Saves consumed 14.01 s summed
across 631 calls. These overlapping call durations are **not additive wall
time**. The CPU profiles independently show 40.80 s sampled in wasm on main
versus 9.72 s final; total run lengths differ.

The original builder's literal React render count was not captured; DOM
mutation counts above must not be renamed render counts. The generated
witness additionally counts actual Bubble renders: 38,251 in its final run,
and records every device query and persistence call. The TypeScript regression
mounts 10,000 row hooks and verifies 49 receipt notifications cause 49 pending
list reads and no unchanged-list rerenders, while admission and settlement
still reach every hook. Without the fix, it installs 10,000 subscriptions.

**Yes, submission waits behind receipt work, but not for 38 seconds in one
wasm admission.** Main's maximum measured core admission queue wait was
30 ms. The SDK serializes network sync/settlement, and preserves FIFO outbox
order. The old hook queued manual delivery/seen writes and full history
walks, with a sync after each settled write. Message POSTs themselves took
about 10 ms; their dispatch occurred much later. In the final trace, measured
sends reached POST
52–553 ms after SDK admission (19 of 20 within 169 ms); the first warmup
took 751 ms. The final core admission queue wait never exceeded 8.7 ms. The
network-chain trace is retained in the
fixed measurement JSON. FIFO ordering was not relaxed. The final optimization
removes intermediate
settlement sync rounds between already-admitted writes.

## Changes and retained guarantees

1. Share a pending-write observation per client/operation and retain snapshot
   identity when its contents do not change. Subscription teardown, stale
   asynchronous answers, failed reads and subsequent admissions remain fenced.
2. Persist clock offset metadata only when it changes. Await the same pending
   save for duplicate callers, retry failed saves, and always persist when
   attaching a different device. Durable admission floors remain separate.
3. After authorizing the member and its source group, probe at most 65 keys
   of a necessary indexed predicate range. Empty ranges certify zero;
   ranges of at most 64 stored rows use the authorized candidate boundary,
   full predicate and expiry checks. Larger ranges retain the existing live
   expiry scan. Public reservations remain independent of hidden counts;
   probes and decoding consume the internal ledger. No limit, disclosure rule,
   schema index requirement or device certification rule was loosened.
4. Skip media reconciliation after a successful `observe_store` reply with
   `reset: false`: this operation changes only metadata. Actual publication,
   replacement, predictions, reads and expiry retain media revalidation.
   Repeated head notifications were needlessly checking every retained asset.
   A deterministic regression observes 49 heads and fails without this fix
   (49 rechecks instead of zero); the native/wasm media, replacement and clock
   suites pass 129/129 afterward. See `media-observation-before.log` and
   `media-final.log`.
5. Share settlement sync across admitted FIFO writes. A durable receipt for
   the preceding `seen` write no longer forces another acquisition round
   before dispatching a queued message. Both the normal POST and recovered
   receipt paths defer this intermediate sync while another write lacks a
   terminal outcome. Dispatch order, retryable-head holds, `begin_send`, store
   binding and durable receipts are unchanged; follow sync still runs.
   `batch-send-before.log` shows the held-sync regression failing without this
   change. The local integration rerun passes 46/46 (`outbox-final.log`);
   the broader admission, receipt, replacement and custody rerun passes
   193/193 (`outbox-custody-final.log`).
6. Document migration from the old guide hook. Remove automatic history
   `loadMore`, manual delivery debt and background `progress` writers when
   using `reports delivery`. Keep visible-screen `seen` reporting. The measured
   copy uses the current guide's coverage-preserving run merger and SDK
   collection after publication, under LLP 3000.022. Missing gaps are never
   assumed delivered. The builder's source tables, sequence allocation,
   authorization and receipt-reading rules remain in place.

The recipe was a real guide defect: receipt reporting should not make a reader
acquire history or place page-by-page acknowledgements ahead of a message.
The current reporting form was already implemented on main; this change makes
the migration obligation explicit. The SDK's duplicate reads/saves and the
server's repeated count certification were separate implementation defects.
An intermediate run with SDK/Rust fixes but the old hook missed the
30-second send/settlement deadline. The [log](pre-migration-failure.log) and
[JSON](pre-migration-failure.json) record only “sent message settled within
30 seconds,” with zero completed measured samples. This is a 30-second miss,
not an established `E_BOUND` refusal. Round 1's attribution of an examined-row
refusal to this run is withdrawn; the separately retained screenshot does not
establish that attribution for the logged run. The history-walking hook
does not scale to a large group. Full-scale operation of the unchanged hook
is not established; API compatibility does not establish that it is slower
but working. The receipts card now says this plainly and shows the migration
to SDK delivery collection and visible-screen `seen`.

The design context was oriented against LLP 3000, 3000.015 §3 (authorized
counting and meters), 3000.020 (device range proofs), 3000.022 (delivery
collection and reporting), 3000.023 (observation retention), and the current
receipts/sequences cards. LLP 3000.015 records the bounded suffix choice;
3000.019 records shared observations, offset saves, settlement sync and media
revalidation.

## Cold readiness

The original 14.1 s was not reproduced on this host. The final 5.892 s is:
97 ms first document, 108 ms credential entry, 4,453 ms login through feed,
1,220 ms full-document conversation navigation, 15 ms remaining acquisition.
The actual login HTTP request took 25 ms. The first snapshot responses carry
roughly 5.37 MB of account data. Cold CPU samples contain about 711 ms wasm,
1,508 ms JS, 266 ms GC and 2,655 ms idle; these describe thread occupancy and
do not decompose the critical path into independently additive causes.

The receipt changes do not improve this cold result. Investigation of durable
installation/reopening and media reconciliation is recorded in
[the cold-acquisition ticket](../../../issues/20260928-rg-cold-web-acquisition.md).
Readiness was not moved earlier or redefined.

## Regression and verification record

- Rust affected row-view suite: **20 passed**, including authorization,
  inherited expiry, capped admission, private recount restart and the new
  50-peer/10,000-message test. `rust-baseline.log` demonstrates the new test
  failing without the initial fix; `rust-verified.log` records final passing.
  A further regression caught an optional probe exceeding a small writer's
  48-row allowance. The probe now checks public budget/schema room first and
  leaves the normal bounded recount available. The new test fails before that
  guard (`probe-budget-before.log`) and passes with it. The duplicate writer
  probe was removed; writer and scalar certification share the live-basis path.
- React hook suite: **50 passed**. The new regression fails on the baseline
  with 10,000 subscriptions instead of one (`react-baseline.log`).
- Clock affected suite: **52 passed**. The new regression fails on baseline
  with 10,001 writes instead of one; it also checks changed receipt samples,
  failure retry and reattachment (`clock-baseline.log`, `clock-final.log`).
- Whole guide: **92 passed, 0 failed** (`guide-final.log`).
- Client build/typecheck and witness typecheck pass. Root reference audit:
  521 LLP documents, no errors or unchecked references (`ref-check.log`).
- Generated Chromium witness: **pass**, 0.963 s cold, **382.7 ms**
  send/settlement p95, **267.3 ms** visible-render p95, **917.2 ms** receipt
  convergence p95. See [witness-summary.json](witness-summary.json),
  [witness-detail.json.gz](witness-detail.json.gz) and [witness-final.log](witness-final.log).
  It also bounds durable work by receipt count: **1,377 saves / 163 metadata
  writes**, against limits of 9,116 / 4,608 for 2,254 peer reports. A control
  using the starting-main production binary and baseline clock/React/pending
  source files (recorded before the later media/sync edits) **fails that work assertion**: 19,584 saves / 16,584 metadata
  writes. Its 845 ms latency happens to pass on this host; the work assertion
  is what makes the witness catch amplification independently of CPU speed.
  See [witness-baseline-summary.json](witness-baseline-summary.json) and
  [witness-baseline.log](witness-baseline.log). The control uses the same current
  guide form, so it isolates implementation costs from the legacy recipe.
- Full suite: invoked **once**, exact summary **`== 1 failure(s) in 1836 s`**.
  The failing stage was `cargo test`, containing the two failed targets below.
  All client tests and all 79 client-model tests passed. See [suite.log](suite.log).
  The final media and shared-settlement optimizations were added after this
  invocation; their affected tests were rerun as recorded above. The full suite
  was not rerun to replace its red record.
  Command, from `snapback4/` (Node 24.13.1):

  ```sh
  ulimit -n 65536
  CARGO_BUILD_JOBS=8 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT SNAPBACK4_RUST_TEST_PROCESSES=8 scripts/test.sh
  ```

Every failure in that full invocation (both **ours**, both corrected):

| Target / test | Failure | Resolution |
|---|---|---|
| `snapback4-core::sync_count_batch` / `cold_snapshot_and_repeated_live_puts_walk_one_basis_per_batch` | The counting test adapter inherited the default unsupported key-only lookup | Forward `index_head` to its MemoryRows and count/bound those probes too; affected target passes 1/1 in `sync-count-final.log` |
| `snapback4-lang::guide` / `every_card_introduces_the_feature_before_examples_and_reference_details` | Migration detail preceded the first example in the version compiled by the full run | Move it after the example; the complete guide rerun passes 92/92 |

Baseline failures: none in that invocation. Environmental failures:
none in that invocation. The earlier missing-wasm export is an
**environmental/evidence setup** failure, resolved by rebuilding the copy.

Introduced failures found and corrected while developing the fixes:
the clock detach test previously expected an unchanged duplicate save (its
fixture now changes the offset before testing the held-save boundary);
the internal-ledger assertion needed to count the added bounded probes;
the first nonempty-range implementation treated expired rejected candidates
as uncovered (four expiry/inherited-source tests caught it; fixed through the
authorized candidate path); the guide introduction initially put migration
detail before its first example (moved after the example). Affected passing
reruns are recorded; no test was removed. The witness's initial setup attempts
also caught its schema filename, inherited deadline immutability and unstable
React operation identities; the final witness fixes all three.

Wasm: **2,019,815 B raw**, **585,384 B gzip**, against the unchanged **586,193 B**
budget. Starting main was 2,019,815 / 585,384 B: raw and gzip **unchanged**,
809 B remaining. Only two panic source-line bytes differ from the baseline
artifact; the final full-corpus run and generated witness use the final hash
in `digests.txt`. No budget increase or new wasm capability.

## Repeating the witness and full-corpus run

From `snapback4/`, with this worktree's dependencies and Chromium available:

```sh
LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT cargo build -p snapback4 --profile production
bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
SNAPBACK4_BIN=target/production/snapback4 node witness/receipts-scale.mjs target/receipts-scale.json
```

The witness generates its fixture from the tested receipts card, adds an
expiring source/unread view, signs up 50 generated accounts, and seeds the
busy group plus 99 other conversations. It launches Chromium over the actual
IndexedDB/wasm client and React hooks, enforces the 1-second p95, reports the
same three timing measures, and removes its temporary app/server/browser.
It does not need the private calibration instrument or store. Persisted
measurements include device calls, saves, render counts and server timings.

For the supplied full corpus, copy `lane/` and `instrument/` under a private
worktree directory, repair only the copy's instrument link, run `npm ci`
there with a worktree-local cache, and copy a fresh original `scale-instance`
for **each** run. Start `snapback4 dev --no-watch --replay` in that instance.
Build the copied Expo app with `EXPO_PUBLIC_SNAPBACK_URL` pointing to that
server; serve it with `WEB_PORT=... node scripts/serve-web.mjs`. Run the
builder's `scale-receipt-probe.mjs`, changing only URL/port/browser location,
or use the retained [profile-probe.mjs](profile-probe.mjs) and
[SDK instrumentation patch](sdk-profiling.patch) as the diagnostic overlay
(apply the SDK patch with `git apply --unidiff-zero`; adjust the probe's
worktree-specific Playwright import). Apply the retained
migration patch to both copied Quarry source directories and app source for
the fixed-form run. Never reuse a store with the 23 added probe messages as
the initial fixture. [wire-probe.mjs](wire-probe.mjs) is a separate, subsequent
single-receipt check and intentionally adds one more message to each copy.
