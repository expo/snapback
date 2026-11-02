# 2026-11-02 — progressive history, chunk 3

Documentation and development measurements are complete in the supplied `sb4/progressive-history` worktree. Changes are uncommitted. No product behavior, contract, protocol default or budget changed. No agents, clones, remote commands, other checkouts, commits, stashes, restores, rebases or pushes were used. **This is the chunk STOP report.**

The early-read result is positive; the full-acquisition regression is material: progressive median **172.425 ms inbox / 267.596 ms foreground / 2500.125 ms full**, versus legacy **1133.121 / 1147.326 / 1185.997 ms**. Full acquisition is **110.804% slower** on the measured fixture. These are development measurements, not qualification or acceptance of that slowdown.

## What changed

Paths below are relative to `snapback4/` unless marked `../llp/`.

| File:line | Change |
| --- | --- |
| `crates/snapback4-lang/src/guide/sync.rs:135` and `:172` | Per-read local admission, horizonless tables whole and first, groups at their declared horizon, supported open-conversation priority, cold stream pin, per-unit usability, full completion, negotiation and staged re-acquisition. Earlier scale numbers are explicitly labeled staged-path measurements. |
| `crates/snapback4-lang/src/guide/writes.rs:99` | Received images, usable coverage and completed walk/catch-up are distinct; unknown reads fall back while covered reads answer locally. |
| `crates/snapback4-lang/src/guide/prediction.rs:70`, `app.rs:116`, `receipts.rs:177` | Remove stale whole-partition query wording while retaining prediction's global gate. |
| `crates/snapback4-lang/tests/fixtures/guide-fact-homes.json:255` | Reconcile the pinned `writes-05` sentence with the walk-or-snapshot completion wording. No test count, budget or runtime assertion was weakened. |
| `packages/snapback4/reference/CLIENT-AND-OPERATIONS.md:747` | Acquisition contract, `usable`, per-read admission, negotiation, unchanged `acquired`/received-count meanings, and an inbox example using the additive field. Line 800 states successful explicit cold/partial `sync()` drives exhaustion while hooks publish per unit. Hook table/history prose also reconciled. |
| `packages/snapback4/reference/CHANGELOG.md:3` | Unreleased entry for the negotiated behavior and preserved completion/prediction rules. |
| `../llp/3000.001.001-prioritized-progressively-usable-history.rfc.md:8` and `:709` | Dated Revised clause and §13 implementation record: paths for chunks 1a/1b/2/2b/3; all eleven witness categories with explicit gaps; HOLD and bounded SKIP/re-service choices; individual measurements and medians; wasm cost. Status remains Draft. §§1, 2, 7 and 9 have marked corrections/clarifications; other pre-existing sections are unchanged. |
| `../llp/3000.001-durable-replica-and-write-lifecycle.research.md:1057` | One short dated pointer to the child implementation record. |
| `NOT-DOING.md:89` | One dated Moves line: early offline inbox/conversation; cold whole-partition barrier removed; one watermark, no result cache/exact horizon maintenance and staged replacement stand. |
| `JOURNAL.md:111030` | One append-only dated entry with commands, verbatim summaries, measurement limitations and the supervisor's wasm attribution. |
| `metrics/witness.jsonl:121` | Two failed setup records, six successful individual records and one median summary. Failures are explicitly `ok:false` and excluded from medians. |
| `reports/20261102-progressive-history-3/measure.mjs:1`, `summarize.mjs:1` | Reproducible measurement-only harness and summary, plus logs/records/command ledger here. |

The package README has nine lines and makes no whole-partition claim, so it is unchanged. The client card stays unchanged at 114 lines. The sync card fits its existing 524-line rendered allowance. Existing large journal/reference files remain in place; new sources, the child RFC and individual evidence files stay below 1,500 lines. Oversized logs were split losslessly; [LOGS.json](LOGS.json) records concatenation hashes.

Read-only LLP orientation followed the child revision 1a, parent Repairs A/B, Snapback 4 instructions/exclusions and scoped governing context. No new LLP, acceptance or publication authority was created.

## Measurements and method

Host: **Charlies-MacBook-Pro-M5Max-Black.local**, **Apple M5 Max**, 18 logical CPUs, Darwin arm64, Volta **Node v24.18.0**. One-minute load samples across the runs: **6.68–8.28**; complete 1/5/15-minute samples are in the JSON. Runs were sequential and no build/test launched by this chunk overlapped the six timed acquisitions.

Used the existing default seed from `witness/scale.mjs` / `witness/lib.mjs::scaleSeed`: **40 groups × 500 messages × 10 members**, 20,440 seeded rows, with the existing chat declarations. The local debug server ran over loopback without added latency; server startup/seeding are excluded from the acquisition clock.

The original Chromium scale runner could not supply these measurements in the sandbox. The shipped wasm instead ran through its Node web adapter, with a measurement-only append journal that fsyncs each persistence batch before success. This is **not IndexedDB or browser qualification**, and makes no power-loss atomicity claim for that journal.

Two fixture-only queries in `media.q` isolate the requested reads. `media.progressiveInbox` omits the maintained `messageCounts` decoration; `media.progressiveHistory` omits the starter's `require`, allowing the existing binder-plan hint extraction for the final group `c039`. Existing schema, declarations and queries are unchanged. Therefore the result does not claim early local readiness for the starter's aggregate-bearing inbox or foreground priority for its guarded thread.

The legacy switch removes only `device_compatibility.advertised` from root/schema responses and asserts no request contains `acquire`. Both modes use the same wasm artifact, client, server and dataset, with fresh processes/stores. Progressive issued 90 sync requests; legacy issued five.

The clock starts immediately before client/device opening. The early milestones are actual known, complete local query results after durable application, not server answers or row counters. Full acquisition is successful explicit `sync()` resolution. Instrumentation includes wire cloning/decoding, query probes, journal fsync and checkpoint copying. Each early checkpoint was reopened offline in a separate Node process and its exact expected row ids checked: **12 successful offline process reopens**. All progressive inbox checkpoints had two whole tables, zero floored groups and `acquired=false`; foreground checkpoints had one floored group and `acquired=false`. Legacy became usable only with `acquired=true`.

| Path / run | Inbox ms | Foreground ms | Full ms | Sampled peak JS heap, B |
| --- | ---: | ---: | ---: | ---: |
| Progressive 1 | 172.425 | 267.596 | 2459.567 | 79,282,864 |
| Progressive 2 | 170.726 | 260.773 | 2507.511 | 61,273,160 |
| Progressive 3 | 172.974 | 267.694 | 2500.125 | 78,819,248 |
| **Progressive median** | **172.425** | **267.596** | **2500.125** | **78,819,248** |
| Legacy 1 | 1135.379 | 1153.137 | 1190.563 | 76,843,464 |
| Legacy 2 | 1130.454 | 1146.421 | 1182.087 | 76,756,776 |
| Legacy 3 | 1133.121 | 1147.326 | 1185.997 | 76,736,040 |
| **Legacy median** | **1133.121** | **1147.326** | **1185.997** | **76,756,776** |

JS heap is sampled `process.memoryUsage().heapUsed` after device calls and every 20 ms, without forced GC. It is neither wasm linear memory nor an exact peak. There is no measured median memory reduction. [measurement-summary.json](measurement-summary.json) retains full precision and individual host/request samples.

The **110.804% full-acquisition regression** exceeds the proposed 25% tolerance in magnitude; this is the default scale fixture, **not the pinned heavy fixture to which §10.2's stop rule applies**. No acceptance tradeoff or default flip is authorized by these results. The 1,000-membership heavy fixture, 10× unrelated-backlog control, cold browser/native runs, interaction/stall campaign, server work, disk-write accounting and resumed-download work remain unmeasured.

## Verification — observed results

All Cargo and Bun invocations ran from `snapback4/`; all Node execution used Volta on PATH. [COMMANDS.jsonl](COMMANDS.jsonl) preserves all **92 shell invocations**, including inspection/edit commands, their cwd, observed exit and verbatim summary or output tail. Multiline invocations retain every line; inspection commands without a summary do not imply a test pass. [VERIFICATION.json](VERIFICATION.json) collects emitted check summaries from the full logs. The measurement driver preserves its five sequential child command invocations in its source command; `measure.mjs` records the server, git identity and offline-reopen subprocess method.

Final `cargo test -p snapback4-lang --test guide`, exit 0 ([log](guide-verified.log)):

```text
test result: ok. 139 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.01s
```

`node scripts/docs-budget.mjs`, exit 0 ([log](docs-budget-final.log)):

```text
docs budget: README 9/320 physical lines
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 138 filtered out; finished in 0.00s
```

`bun run --cwd packages/snapback4 build`, exit 0 ([log](client-build.log)); last emitted summaries:

```text
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

Repository-root `./ref-check --verbose`, exit 0 ([log](ref-check-root.log)):

```text
ref-check: ok — 583 LLP docs, 12978 refs in 51354 files, 0 errors, 0 unchecked
```

Final `git diff --check`: exit 0, no diagnostics. Scope/protected-file checks confirmed no diff to `contract.ts` or `metrics/wasm-budget.json`, and all changed tracked files are under `snapback4/` or `llp/`.

The required affected command was invoked exactly as:

```sh
node scripts/affected.mjs --base origin/main --worktree --run
```

Its environment additionally loaded [affected-guard.cjs](affected-guard.cjs), which redirects the runner's receipt directory into this chunk's `snapback4/` fence and exits immediately before the mandatory wasm step. This preserves the instructed once-only standalone final build and prevents the excluded browser stages. It does not fake success. **Exit 125; incomplete; no affected-gate pass.** The receipt is `snapback4/target/affected/eb9dd81af9c8-1793629917815.json`, with `complete:false` and only successful install-client/build-cli results. It predates final narrative edits and cannot certify the final tree.

Verbatim affected summaries ([part 1](affected.part-01.log), [part 2](affected.part-02.log)):

```text
# 32 commands, 7 whole Rust packages, 490 client files; broad=true
Checked 649 installs across 627 packages (no changes) [195.00ms]
    Finished `dev` profile [unoptimized] target(s) in 40.14s
STOP: affected build-wasm not run; final standalone wasm build runs once. Browser suites not run (sandbox); affected run incomplete.
```

Earlier guide runs are preserved: 138 passed/1 failed (537 > 524 sync lines); 137 passed/2 failed (stale writes-05 and compression word target); 138 passed/1 failed (optional client-card text exceeded its word target). Shortened prose, updated the stale fact and dropped the optional client-card addition; no allowance was raised.

Two measurement setup attempts failed before the timing clock, because the added queries are named `media.progressiveHistory`/`media.progressiveInbox`; both failed records/logs remain, excluded from medians. All six corrected runs report `"ok":true`.

The first `../ref-check --verbose` ran from the wrong cwd and reported:

```text
ref-check: FAIL — 0 LLP docs, 4224 refs in 25344 files, 4224 errors, 0 unchecked
```

Its lossless split log is retained; the corrected root invocation above passed. No loopback-binding failure occurred in the measurements, so no bind retry was needed.

## Final wasm

Chunk 2b changed Rust. Ran `bash scripts/build-wasm.sh` **once**, exit 1 for the expected budget overrun ([log](wasm.log)):

```text
wasm 2442606 B raw, 746547 B gzip (budget 739004: OVER by 7543 B — issues/20260913-snapback4-wasm-device-diet.md)
```

| Supervisor / final artifact | Raw B | Gzip B |
| --- | ---: | ---: |
| Base 18c70392f2 | 2,416,839 | 737,887 |
| After 1a+1b, supplied by supervisor | 2,440,792 | 746,060 |
| Final, measured here | 2,442,606 | 746,547 |

The supervisor's +23,953 B raw / +8,173 B gzip is attributable to device-side progressive acquisition code (cursor/facts persistence, per-read admission, boundary count, backend-record discriminator). This attribution and both supplied measurements are in the journal and RFC. `metrics/wasm-budget.json` is untouched; the supervisor's final-gzip-plus-500 rule would set **747,047 B** at landing. `issues/20260913-snapback4-wasm-device-diet.md` remains the standing place to recover the bytes.

## Limits and open questions

- `react.test.mjs`, `witness/idb.mjs`, and the original Chromium `witness/scale.mjs`: **not run (sandbox)**. The Node/wasm measurements do not substitute for real browser persistence/rendering qualification.
- The affected runner's remaining Rust/client/browser stages and the complete/publication battery were not run. This documentation chunk did not repeat the earlier chunks' correctness suites; §13 maps witnesses that exist and cites their reports.
- §10.1 remains partial: no real-browser crash/transaction-abort campaign, no SQLite failure injection at every boundary, no combined ambiguous-receipt/cross-tab/offline-capture partial-walk campaign, no dedicated mid-walk sign-out/viewer-switch disclosure campaign, and no exhaustive meter-cut/unsupported-shape matrix. The simulator's 32 schedules and quiescence oracle are bounded evidence. Per-program prediction, sub-horizon slices, recency sorting and progressive re-acquisition are not built.
- Code wins over the baseline prose: legacy ordinary terminal pages could set acquired; delivered-history preserves floors on leave; same-store restore remains a halt; unsupported tables do not force a blanket schema-wide legacy downgrade. Query preflight still needs a whole fact or a boundary for each synced read-site table, so a held point row alone cannot bypass it in an otherwise unfloored table.
- No hint is inferred for a `require`-bearing query, and inbox results do not seed hints. Chunk 2 did not change a messaging-app component; this chunk supplies the documented inbox example, with no app behavior change.
- Supervisor decisions remain: measure the heavy/backlog/browser/native cases, address or explicitly accept the qualified full-acquisition cost, finish excluded checks, and set the wasm budget in the landing. This report makes none of those decisions.

Stopped at chunk 3. The supervisor owns the commit and subsequent work.

