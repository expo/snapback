# 2026-11-02 — progressive history, chunk 2c

**Complete; stopped at chunk 2c. Changes are uncommitted.** Whole units now pack into one bounded acquisition reply and publish in one device transaction. No default switch, contract reshaping, ceiling increase or budget-file edit was made. No agents, clones, remote commands, other checkouts, commits, stashes, restores, rebases or pushes were used.

**Full acquisition is within 25% of legacy on both measured fixtures:** default median **1,129.205 ms versus 1,173.386 ms (−3.765%)**; heavy median **6,611.020 ms versus 5,624.784 ms (+17.534%)**. Heavy inbox/foreground medians are **851.754 / 862.614 ms**, versus **5,394.681 / 5,497.194 ms** legacy. These are Node/wasm development results on the requested heavy approximation, not complete browser/native qualification or a default decision.

## What changed

Paths are relative to `snapback4/` except the explicitly marked LLP.

| File:line | Change |
| --- | --- |
| `crates/snapback4-core/src/partition/acquire.rs:27`, `:58`, `:192` | Add `units`, retain `unit` as the first, reuse group enumeration within the page's read transaction, and pack consecutive units under one shared delivery budget. Tier 1 precedes tier 2; an eligible hint precedes normal groups; at most one priority unit per page. Merge marker offsets, joined groups, whole-table facts and skipped groups. A candidate that exceeds row room or delivery budget leaves its cursor/facts unadvanced. |
| `crates/snapback4-core/src/partition/delivery.rs:19` | Expose remaining row room so divisible tier-1 pages fit the unchanged 8,192-row delivery ceiling. The request still clamps to 1–10,000. A first group may exceed the request limit but remains subject to delivery ceilings. Empty units consume one scheduling slot to bound metadata-only replies. |
| `crates/snapback4-device/src/device/acquisition.rs:24`, `:64`, `:118` | Deserialize additive `units` with legacy fallback; validate every unit and the first-entry alias; apply retained tier-1 bookkeeping by table in mixed pages. The existing ordinary applicator already records all rows, floor markers, whole-table facts and cursor in the same transaction, including Repair B deferral. No new publication path, watermark or staging namespace. |
| `packages/snapback4/src/local-acquisition.ts:19`, `:133` | Accept the additive response and remember all published groups within the existing 32-entry volatile skip set. `local.ts` and its one-in-flight loop are unchanged; fewer replies mean fewer rounds. |
| `crates/snapback4-core/tests/progressive_acquisition.rs:122`, `:250` | Preserve the exact rows/floors quiescence oracle while enumerating all units; add packing order, hint-first, oversized-alone, per-group marker offsets, terminal exhaustion, budget-stop and remaining-row-room witnesses. |
| `crates/snapback4/tests/serve_sync/progressive.rs:41`, `:92` | Assert additive HTTP shape, first-unit alias, multiple whole-table facts and group floors, pin and exhaustion; retain legacy reply compatibility checks. |
| `crates/snapback4-device/src/device/progressive_tests.rs:49`, `:62`, `:90` | Exercise packed and single-unit commit failure and host-persistence discard/reopen; reject malformed later units/rows without publishing earlier facts. |
| `crates/snapback4-device/tests/progressive_history.rs:182`, `:339` | Keep the completion-after-pin witness multi-page with a smaller limit; add mixed-page facts/reopen and unchanged rows/floors/answers oracle checks on memory and SQLite. No oracle was weakened. |
| `packages/snapback4/test/helpers/progressive-acquisition.mjs:58`, `:124`; `test/progressive-acquisition.test.mjs:274` | Parameterize only the fixture's limit; test multi-unit durable `usable` counts/reopen on process and wasm adapters and the 32-entry skip cap. Existing small-page tests retain limit 2. |
| `crates/snapback4-lang/src/guide/sync.rs:173` | Describe bounded packed pages and page-level publication. Guide compiles and fits existing budgets. |
| `../llp/3000.001.001-prioritized-progressively-usable-history.rfc.md:8`, `:217`, `:306`, `:787`, `:856`, `:956` | Record packing in the design and implementation sections, replace §13's current measurement table with both fixtures, preserve the prior result as history, and record new wasm/test evidence. Status remains Draft; no new LLP number. |
| `JOURNAL.md:111069` | Append a dated implementation, measurement, command-summary and wasm paragraph. No prior entry was rewritten. |
| `metrics/witness.jsonl:130` | Append twelve successful runs, two median records and two failed heavy attempts explicitly marked false. |
| `reports/20261102-progressive-history-2c/measure.mjs:1`, `summarize.mjs:1`, `run.py:1` | Retain the measurement harness, exact heavy setup, comparisons, command recorder and evidence. `measure-before-heavy-batching.mjs` and `measure-before-inbox-check.mjs` preserve earlier harness versions matching failed/default-run artifact hashes. |

Scoped `llp-orient` context: child §§5–6/9/10, parent Repairs A/B, LLP 3000's partition/current-image rules and the Snapback 4 fence/exclusions. One watermark, current readable images, existing server-named floors plus whole-table facts, prediction's global gate, staged replacement, and the existing publication transaction remain governing constraints. No additional design hand-off is needed for this chunk.

Code wins over earlier prose: revision 1 described one unit per reply; this implementation packs units. Tier-1 transfer pages are divisible at the remaining row allowance; horizoned groups are atomic. Enumeration reuse is transaction-local, not durable discovery metadata. Whole-table facts still exclude unsupported shapes. Partial progress never writes legacy `ACQUIRED`; only exhausted walk plus final head coverage completes acquisition. The public `contract.ts` is untouched.

## Measurements and method

Same host as chunk 3: **Charlies-MacBook-Pro-M5Max-Black.local, Apple M5 Max, 18 logical CPUs, Darwin arm64**, exact Volta **Node v24.18.0** for all timing and reopen processes. Observed one-minute load samples: **7.35–10.35**; all 1/5/15-minute samples are recorded. Runs were sequential, with no build or test launched by this chunk overlapping timed acquisition. Both paths used the same new wasm, debug CLI binary, schema and dataset; the summary script asserts those hashes and the host/runtime pin.

Default uses unchanged `scaleSeed({groups:40,messages:500,members:10})`: **20,000 messages / 20,440 seeded rows**. Heavy starts with `scaleSeed({groups:1000,messages:91,members:10})` and removes `msg00090` from `c000`–`c499`: **90,500 messages**, **1,000 conversations**, **10,000 membership rows**, including **1,000 for bob**, and **101,500 total seeded rows**, plus generated maintains. Group `c999` has 91 messages. This reproduces the card's viewer-membership/message counts, not its broader **105,034-row** benchmark. Heavy setup sends 10,000 rows per seed request under the unchanged 16 MiB HTTP body limit; setup/startup are outside timing.

The method is chunk 3's shipped wasm through the Node web adapter with a measurement-only append journal that fsyncs each persistence batch. It is not IndexedDB, native timing or a power-loss qualification. Two added fixture queries omit the maintained inbox count and the thread's `require`, leaving original queries/declarations unchanged. The mounted foreground query infers `c039` (default) or `c999` (heavy). The heavy inbox is a known, complete **first page of 50**, not all 1,000 conversations displayed at once.

The clock begins before client/device opening. Inbox and foreground milestones are actual known, complete local answers after durable page application. Full acquisition ends at successful explicit `client.sync()` resolution. Wire cloning/decoding, query probes, journal fsync and checkpoint copying are included. The legacy control removes only `device_compatibility.advertised` from root/schema replies and asserts no `acquire` request. Each early checkpoint was reopened offline in a fresh Node process and exact expected IDs verified: **24 successful offline reopens**, all stale; progressive early checkpoints remained `acquired=false`, legacy checkpoints were acquired. Packed progressive checkpoints contained two whole tables and 15 / 48 floored groups for default / heavy.

| Fixture / path / run | Inbox ms | Foreground ms | Full ms | Sync requests | Sampled peak JS heap, B |
| --- | ---: | ---: | ---: | ---: | ---: |
| default / progressive / 1 | 476.438 | 482.418 | 1141.019 | 6 | 70,922,152 |
| default / progressive / 2 | 477.954 | 485.060 | 1123.862 | 6 | 70,787,824 |
| default / progressive / 3 | 486.672 | 494.334 | 1129.205 | 6 | 70,721,408 |
| **default / progressive / median** | **477.954** | **485.060** | **1129.205** | **6** | **70,787,824** |
| default / legacy / 1 | 1121.625 | 1144.199 | 1192.898 | 5 | 74,126,880 |
| default / legacy / 2 | 1098.531 | 1123.468 | 1173.098 | 5 | 76,535,592 |
| default / legacy / 3 | 1100.070 | 1125.125 | 1173.386 | 5 | 76,858,152 |
| **default / legacy / median** | **1100.070** | **1125.125** | **1173.386** | **5** | **76,535,592** |
| heavy / progressive / 1 | 851.754 | 862.614 | 6593.396 | 26 | 128,955,056 |
| heavy / progressive / 2 | 839.661 | 851.562 | 6622.268 | 26 | 129,115,624 |
| heavy / progressive / 3 | 855.411 | 865.330 | 6611.020 | 26 | 128,632,096 |
| **heavy / progressive / median** | **851.754** | **862.614** | **6611.020** | **26** | **128,955,056** |
| heavy / legacy / 1 | 5338.405 | 5440.214 | 5578.368 | 13 | 225,559,648 |
| heavy / legacy / 2 | 5444.644 | 5574.048 | 5709.789 | 13 | 225,636,448 |
| heavy / legacy / 3 | 5394.681 | 5497.194 | 5624.784 | 13 | 225,593,608 |
| **heavy / legacy / median** | **5394.681** | **5497.194** | **5624.784** | **13** | **225,593,608** |

Default requests are **3 acquire + 3 ordinary = 6** versus legacy **5** (including 3 snapshot pages). Heavy uses **13 acquire + 13 ordinary = 26** versus legacy **13** (including 11 snapshot pages). Response bytes per run are 5,384,468 / 5,218,326 for default progressive / legacy, and 26,526,848 / 25,293,100 for heavy. Bounded skip eviction may still cause idempotent re-service; no exact-once download promise was added.

Sampled heap is `process.memoryUsage().heapUsed` after device calls and every 20 ms, without forced GC. It is neither wasm linear memory nor an exact peak. Median sampled JS heap falls on both fixtures; the heavy reduction is about **42.8%**. Full-precision runs, load samples and request counts are in [default summary](default-measurement-summary.json) and [heavy summary](heavy-measurement-summary.json), with individual JSON records beside them.

Packing trades some earliest-read latency for throughput: chunk 3's default inbox/foreground measured 172.425 / 267.596 ms; these packed medians are 477.954 / 485.060 ms. They retain an early-read win against the matched legacy control while default full acquisition drops from chunk 3's 2,500.125 ms / 90 requests to 1,129.205 ms / 6 requests. **Default −3.765% and heavy +17.534% are both within 25% of their matched legacy medians.** No default-vs-opt-in decision or larger-slowdown tradeoff was made.

Two failed heavy attempts are preserved and excluded from medians:

- `heavy-progressive-1-seed-failed.json`: the single seed request exceeded 16 MiB before any acquisition timing. Fixed only setup batching.
- `heavy-progressive-1-probe-failed.json`: acquisition ran, but the harness expected the heavy inbox to have `complete=false`, borrowing the original decorated scale query's assertion. The new ordinary query actually returns a covered first page with `complete=true`. Restoring chunk 3's original complete-local-answer criterion produced successful timed/offline checks. No product change or limit adjustment followed either failure.

## Verification and command evidence

[COMMANDS.jsonl](COMMANDS.jsonl) records every shell invocation, including inspections and edits. [CHECKS.jsonl](CHECKS.jsonl) records each check/measurement child command, exit, log and emitted summaries; [VERIFICATION.md](VERIFICATION.md) renders those commands and **verbatim** summary lines, including all 106 full-device target summaries, initial attempts and failures. Inspection/edit commands with no emitted test summary have their observed status recorded; they do not imply a test pass. The device log was split losslessly into three files under 1,500 lines; [LOGS.json](LOGS.json) records concatenation order, size and SHA-256.

All Cargo/Bun commands ran from `snapback4/`. Observed final results:

| Command / suite | Result |
| --- | --- |
| `cargo test -p snapback4-core --test progressive_acquisition` | 13 passed, 0 failed |
| `cargo test -p snapback4 --bin snapback4 sync_generation_tests::progressive` | 3 passed, 0 failed |
| `cargo test -p snapback4-device` | Exit 0; aggregate **1,596 passed, 0 failed, 4 ignored**, 106 target summaries |
| `cargo test -p snapback4-device --test progressive_history` | 11 passed, 0 failed |
| `cargo test -p snapback4-sim --test progressive_history` | 1 passed, 0 failed; existing 32 schedules |
| `cargo test -p snapback4-lang --test guide` | 139 passed, 0 failed |
| `node --test packages/snapback4/test/progressive-acquisition.test.mjs` | Node 24: 29 passed, 0 failed, 1 browser skip |
| `node --test packages/snapback4/test/acquisition.test.mjs` | Node 24: 47 passed, 0 failed |
| `node --test packages/snapback4/test/progressive-start.test.mjs` | Node 24: 48 passed, 0 failed |
| `node --test packages/snapback4/test/ordinary-history.test.mjs` | Import failure, 0 product cases run: sandbox `ps` EPERM |
| `node --test packages/snapback4/test/retained-history.test.mjs` | Import failure, 0 product cases run: sandbox `ps` EPERM |
| `bun run --cwd packages/snapback4 typecheck` | Exit 0, `$ tsc -p tsconfig.json --noEmit` |
| `bun run --cwd packages/snapback4 build` | Exit 0; guide API budgets pass |
| `cargo build -p snapback4` | Exit 0; new debug binary used in measurements |
| Root `./ref-check --verbose` | Exit 0; summary below |
| `git diff --check` | Exit 0, no diagnostics |

```text
ref-check: ok — 583 LLP docs, 12985 refs in 51382 files, 0 errors, 0 unchecked
```

The full device build began before the last server-only remaining-row-room adjustment; final core, HTTP, simulator and device progressive checks cover that adjustment. Device publication code was unchanged during these checks. The original quiescence oracles remain intact; the new packed-page device witness compares rows, boundaries, whole facts and query results with full acquisition on both stores.

The initial HTTP command used the wrong filter (`serve_sync::progressive`) and matched zero tests; it is retained and is not HTTP evidence. The corrected command above ran all three tests. The first shell wrapper selected ambient **Node v25.9.0** despite a Volta PATH entry; initial ordinary-history/progressive attempts and the pre-correction build commands are retained. The wrapper now uses the exact Node 24.18.0 image with Bash and asserts its version. Typecheck, client build and those client tests were rerun on Node 24; acquisition, retained-history and progressive-start also ran on Node 24. All twelve timing runs and all reopen processes used Node 24.18.0.

Both blocked client suites report:

```text
Error: TEST_SIGNAL_REFUSED: cannot build Darwin identity inspector: TEST_COMMAND_INSPECTION: ps failed: spawn EPERM
```

No loopback-binding failure occurred, so no binding retry was needed. The two failed heavy harness attempts were corrected as described above and are not successful measurements.

## New wasm artifact

Ran `bash scripts/build-wasm.sh` **once**, before measuring. It produced the new artifact and exited 1 for the expected unchanged-budget overrun:

```text
wasm 2444934 B raw, 747296 B gzip (budget 739004: OVER by 8292 B — issues/20260913-snapback4-wasm-device-diet.md)
```

Delta from chunk 3: **+2,328 B raw / +749 B gzip**. `metrics/wasm-budget.json` is untouched. This build preceded the Node-wrapper correction and was not repeated, respecting the once-only instruction. The Node measurements used **this newly built wasm**, copied into the rebuilt client, not the pre-chunk artifact. All run records hash it and the new server binary. The supervisor owns the landing artifact/budget decision.

## Not run, limits and open questions

- `react.test.mjs`, `witness/idb.mjs`, and Chromium `witness/scale.mjs`: **not run (sandbox)**, as instructed. The two `ps`-blocked client suites need the supervisor's environment; neither is claimed green.
- No broad affected runner, complete workspace/publication battery, native timing, real IndexedDB crash campaign, ten-times-backlog fixture, interaction/stall campaign, resumed-download accounting or original broader 105,034-row heavy dataset. These do not follow from Node development measurements.
- Packed commit failure/host-discard recovery is injected on the memory adapter; SQLite mixed-page durable reopen and oracle equivalence pass. No physical crash or SQLite I/O-failure campaign at every packed-page boundary was performed.
- Earlier code limits remain: unsupported coverage shapes gain no new whole-table facts; supported ordinary history plans infer hints, guarded `require` plans do not; writes/prediction retain the global gate. No second cut, row-version history, exact horizon maintenance, per-query receipts/cache or progressive replacement was added.
- The supervisor still decides default-vs-opt-in and landing. The measured heavy slowdown is inside 25%, but this report does not accept the RFC or claim full §10.2 platform qualification.

**STOP: chunk 2c complete.** Leave all changes in this worktree for the supervisor to commit.
