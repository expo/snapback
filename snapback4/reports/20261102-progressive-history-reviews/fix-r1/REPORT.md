# Progressive history — review fix round 1

2026-11-02. Worktree branch `sb4/progressive-history`; review base `4817becce8`.
Five confirmed defects fixed in the working tree. No commit, stash, checkout,
restore, rebase, push, agent, clone, remote command, or wasm rebuild.

## Changes

Paths below are relative to `snapback4/`.

| Finding | Implementation | Regression |
| --- | --- | --- |
| Grok 1: empty delivered-history rejoin | `crates/snapback4-device/src/device/boundary.rs:127` treats persisted Left/Rejoined membership as sufficient to write an unknown start marker, even without rows or an earlier boundary. `device/history.rs:146` also rejects boundary-based live coverage when membership coverage is Unknown, including a wrongly persisted old floor. Left groups retain their separate retained-history coverage. | `crates/snapback4-device/tests/progressive_history.rs:238`: leave with no message rows/boundary, acquire the rejoined window before stream delivery, reopen, require unknown/incomplete, receive the join and acquire again, then complete only after staged replacement. Both retention policies, memory and SQLite. Also injects a previously erroneous floor to exercise the independent read-side guard. |
| Astra 1: early tier-1 whole fact | `crates/snapback4-device/src/device/acquisition.rs:99` stores the finishing page's `images_at`; `:142` and `:190` gate usable-table counts and query admission on the sole applied watermark reaching that head. `:153` and `device.rs:975` invalidate table observations when the pending fact becomes effective. Rows, fact and cursor still commit/defer together. | `tests/progressive_history.rs:280`: actual engine pagination delivers x(rank=100), y moves from 50 to 200 behind the descending continuation, the next page finishes without y. The miss is unknown before and after reopen, then true/complete after stream repair. Both stores. |
| Astra 2: abandoned snapshot owner | `crates/snapback4-device/src/device.rs:752` exposes a persisted snapshot owner that this runtime does not own as `replacement_required`. The existing client restarts staged acquisition before considering progressive pages. | `tests/progressive_history.rs:319` persists the first legacy snapshot page, reopens, restarts staging and completes on both stores. `packages/snapback4/test/progressive-acquisition.test.mjs:297` reopens against an advertising server, asserts no acquire requests and completes through staging; native client passes. |
| Astra 3: unbounded drain turn | `packages/snapback4/src/local-acquisition.ts:127` yields after four published ordinary pages even with backlog, allowing the next acquisition and queued write. Deferred publication cannot yield; device deferred-slot and replacement checks still take precedence. `local.ts:932` releases the network owner without claiming caught-up when more remains. | `test/progressive-acquisition.test.mjs:217` now injects three real writes during each two-event drain page for a bounded 24-page campaign. It checks send dispatch within four draining pages and acquisition advancing before backlog ends. `:45` separately checks that deferred publication and replacement fences cannot be bypassed. |
| Astra 4: late tier-1 heap check | `crates/snapback4-core/src/partition/acquire.rs:122` passes the shared delivery budget into the walk. `partition/snapshot.rs:82` reserves at most 64 rows plus lookahead before decoding and charges retained rows between batches. `partition/delivery.rs:25`, `:52` share scratch admission and retention accounting with group expansion. | `tests/progressive_acquisition.rs:77` uses an actual 8 KiB payload with an oversized declared decode reservation; it must refuse before materializing the candidate, though actual wire bytes fit. `partition/delivery.rs:156` verifies that earlier packed payloads reduce later scratch room under the unchanged heap ceiling. No memory benchmark. |

The sync card (`crates/snapback4-lang/src/guide/sync.rs:173`), the existing RFC's
§§4.2, 5.1, 6.4/revision record, and the append-only dated journal entry describe
the corrected behavior. No new LLP number, refusal code, dependency, budget,
protocol field, contract reshaping, or public readiness meaning.

## Governing context and code facts

Read the complete target RFC and both blind reviews, the Snapback 4 agent sheet,
NOT-DOING, parent Repair A/B, root/brief constraints and relevant sync card.
Applied the read-only `llp-orient` workflow within this scope.

- LLP 3000.001.001 §§5.1–5.3 and 6.1–6.4 govern the two existing coverage facts,
  one applied watermark, direct cold publication and staged replacement.
- Parent Repair A requires a server-named boundary, never range knowledge
  inferred from retained row counts. Repair B still defers rows, cursor,
  acknowledgements and publication together.
- §7 keeps mutation/prediction globally gated. §9 keeps negotiation and old-peer
  fallback. No new cuts, query cache/receipts, version history or exact horizon maintenance.

The code, not broader proposal wording, determines these details: the audience
index can include a mutable non-audience ordering column, so a tier-1 finish is
pending evidence until stream repair; a Left group's existing retained suffix
can remain complete under the sync card, while a live Rejoined range cannot;
and an interrupted legacy snapshot has durable ownership even when the reopened
runtime has no in-memory owner. Legacy history also labels first-time ordinary
joins `Rejoined`; its existing floor contract must remain usable. The new read
guard therefore applies only after the durable progressive-format discriminator
is present. The changes preserve those distinctions.

## Counterfactuals

All five regressions were observed failing without their corresponding fix.

1. **Grok 1:** the first device progressive run, before product edits, failed
   `empty_group_rejoin_requires_staged_replacement_on_both_stores` with
   `left: false / right: true` for unknown coverage. The final case also asserts
   the stored marker is exactly `unknown`, and injects an erroneous real floor
   to ensure the read guard independently prevents a complete live range.
2. **Astra 1:** after correcting the fixture's sync declaration, temporarily
   restored only the whole-fact write from `images_at` to `watermark`, ran the
   regression, and restored the fixed source in Python `finally`. The
   [counterfactual log](./tier1-counterfactual.log) shows
   `data: Bool(false)`, `complete: true` and the unknown assertion failing.
   An earlier fixture attempt failed to compile with E_SYNC; that is not counted
   as a product reproduction.
3. **Astra 2:** the pre-fix device run failed the abandoned-owner
   `replacement_required` assertion. The
   [unrecompiled-wasm client run](./client-interrupted-old-wasm.log) also failed
   to become acquired after reopening against the advertising server. The final
   native-client version passes; the new Rust test passes on both stores.
4. **Astra 3:** the rewritten traffic witness failed on both adapters before the
   scheduler change. After correcting the assertion to measure from the held
   acquisition request (excluding a preceding drain), temporarily disabled the
   compiled scheduler's cap (`>= Infinity`), ran both cases again, and restored
   the compiled file in `finally`. The
   [counterfactual log](./client-backlog-counterfactual.log) shows 36 stream pages
   after that acquisition before dispatch. Both fixed cases pass with the
   four-page bound, including while acquisition still advances.
5. **Astra 4:** [core-before.log](./core-before.log) records the new decode
   admission test failing before the budget was passed into the walk. Actual
   8 KiB bytes fit the old post-walk push check, so the old code accepts the
   candidate; the corrected code refuses its decode reservation first.
   Both final core tests and the shared-budget unit tests pass.

Temporary counterfactual changes were restored. None remains in source or dist.

## Verification

Cargo and Bun ran from `snapback4/`. Client test commands explicitly use Volta's
Node 24.18.0. The native CLI was rebuilt before final client runs. The Bun client
build transpiles TypeScript and copies the **existing** wasm artifact; it does
not rebuild wasm. Browser validation is not implied.

| Command | Verbatim observed summary |
| --- | --- |
| `cargo test -p snapback4-core --test progressive_acquisition` | `test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.42s` |
| `cargo test -p snapback4-core --lib partition::delivery::tests` | `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 842 filtered out; finished in 0.01s` |
| `cargo test -p snapback4 --bin snapback4 sync_generation_tests::progressive` | `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 782 filtered out; finished in 0.05s` |
| `cargo test -p snapback4-sim --test progressive_history` | `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.30s` |
| `cargo test -p snapback4-device --test progressive_history` | `test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s` |
| `cargo test -p snapback4-device` (final) | `EXIT_STATUS=0`; all 106 verbatim target summaries are in [DEVICE-SUMMARIES.txt](./DEVICE-SUMMARIES.txt). Derived totals: 1,599 passed, 0 failed, 4 ignored. |
| `cargo test -p snapback4-lang --test guide` (final) | `test result: ok. 139 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.86s` |
| Client progressive | `ℹ tests 33`, `ℹ pass 31`, `ℹ fail 1`, `ℹ skipped 1` |
| Client acquisition, final rebuilt native CLI | `ℹ tests 47`, `ℹ pass 47`, `ℹ fail 0`, `ℹ skipped 0` |
| Client progressive-start | `ℹ tests 48`, `ℹ pass 48`, `ℹ fail 0`, `ℹ skipped 0` |
| Client ordinary-history | `Error: TEST_SIGNAL_REFUSED: cannot build Darwin identity inspector: TEST_COMMAND_INSPECTION: ps failed: spawn EPERM` |
| Client retained-history | Same verbatim harness error; no product cases executed |
| `bun run --cwd packages/snapback4 typecheck` | `$ tsc -p tsconfig.json --noEmit`; `EXIT_STATUS=0` |
| `bun run --cwd packages/snapback4 build` | `guide api auth: 503/2400 tokens`; `EXIT_STATUS=0` |
| `cargo build -p snapback4 --bin snapback4` | ``Finished `dev` profile [unoptimized + debuginfo] target(s) in 7m 34s``; `EXIT_STATUS=0` |
| Root `./ref-check --verbose` | `ref-check: ok — 583 LLP docs, 12999 refs in 51393 files, 0 errors, 0 unchecked`; `EXIT_STATUS=0` |
| `git diff --check` | No output; tool `exit_code: 0` |

The progressive client run is **not a green suite**: its only failure is the new
wasm interrupted-snapshot regression against the old artifact. The attempted
negative name pattern did not exclude that case; it actually ran and failed.
The native counterpart, tier-1 inbox on both adapters, and both sustained-backlog
cases passed. Existing wasm cases validate the JavaScript changes against the
old wasm; the Rust fixes are validated on the memory and SQLite stores, not a
newly built wasm module.

The first guide run passed 138 and failed 1 (`sync: 525 > 524`). Rewording the
changed paragraph restored the existing line limit; no budget was raised.
The first full device run failed 44 of 142 W13g cases because the initial read
guard also blocked legacy first-time joins. After limiting the guard to upgraded
progressive partitions, the combined W13g/progressive rerun emitted:

```text
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.17s
test result: ok. 142 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.42s
EXIT_STATUS=0
```

The subsequent full device rerun uses this final compatibility guard. The native
client suite above preceded that final Rust guard adjustment; the final Rust
device run exercises it directly, including both stores and legacy first joins.
No loopback-binding failure occurred, so no loopback retry was needed.
The early legacy-acquisition client run also passed 47/47; the final run was
repeated after rebuilding the native CLI.

Full command history, including inspection commands, initial fixture failures,
counterfactual wrappers and every emitted test summary, is recorded in
[CHECKS.jsonl](./CHECKS.jsonl), [command record 1](./COMMANDS-1.md),
[command record 2](./COMMANDS-2.md) and [command record 3](./COMMANDS-3.md).
Raw verification logs are beside this report.

## Not run / remaining limits

- `react.test.mjs` and `witness/idb.mjs`: **not run (sandbox)**, as instructed;
  the supervisor owns browser/React/IndexedDB validation.
- Ordinary-history and retained-history were attempted but blocked during
  harness import by sandbox process-inspection EPERM.
- No `build-wasm`, wasm-size qualification, publication, performance campaign
  or slow memory benchmark. The supervisor must rebuild wasm and rerun the
  new interrupted-snapshot client regression; its old-artifact failure remains
  explicitly recorded.
- Pre-existing file-size violation: `packages/snapback4/src/local.ts` was
  2,071 lines at the review base and is 2,070 now. This fix changes only the
  turn-exit block and places scheduling logic in the 150-line
  `local-acquisition.ts`; it does not perform an unrelated large refactor.
  Every other changed source file is below 1,500 lines. This is an outstanding
  exception to the requested file-size rule, not a claim of compliance.
- No further design question for the five fixes. Remaining handoff work is
  artifact/browser/sandbox verification and the existing oversized client file.

STOP: fix round 1 only. Changes remain uncommitted for the supervisor.

