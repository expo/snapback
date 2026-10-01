# WB round 0 — wall-clock budgets

The test suite now waits for observable state or promise completion, with separate work-scaled hang guards. No product source changed. The fallback case retains every answer and ordering assertion and explicitly checks that sync is still held when the current whole-server answer arrives.

The common guard is `120,000 + 2,000 × max(1, work)` ms. It uses captured real timers and a monotonic clock, so mocked semantic time cannot disable it. Bulk guards count rows, operations or histories; ordinary guards count awaited fixture phases. Expiry, retry, heartbeat, admission and other genuine product timing assertions retain their bounds.

[AUDIT.md](AUDIT.md) explains every retained/converted family. [BUDGET-SITES.md](BUDGET-SITES.md) lists every original explicit timeout option; [before](audit-before.tsv) / [after](audit-after.tsv) give the complete candidate-site census, including helpers and embedded browser fixtures. The scope contains 353 JS/TS/TSX files. The shared `witness/lib.mjs` change is test infrastructure used by those fixtures.

## Verification

Final source coverage includes **235 affected test files**, five times on eb1000 under SL's 48-busy-worker / ten-CPU recipe, plus one unconfined run. Each loaded repetition uses three ordinary file slots; full-count session models run in their own serial slot. Search retains 300 seeds per host and session models retain 5,000 sequences per tier. No seed/count reduction was used. Runner concurrency follows SL’s CPU policy: three loaded file slots and 24 unconfined slots; the whole script uses its defaults.

The five loaded repetitions are **source-bound composites**: unchanged passing files from the initial snapshots, five runs of all 18 scopes changed afterward, and five complete client-seams/search reruns after their final repairs. The superseded invocations had failures and are retained below; they are not claimed as clean sweeps. Every changed scope receives complete final-file coverage in each repetition. The manifests and [qualification.json](qualification.json) bind this claim to the tested bytes. [METHOD.md](METHOD.md) documents the isolated checkouts, commands, affinity, load custody and exact scope.

| Execution | Pass / fail / skip / cancel | Elapsed seconds | Evidence |
|---|---:|---:|---|
| 1: Initial snapshot | 4,462 / 6 / 9 / 1 | 5123.1 | [heavy-1.log](heavy-1.log), [metadata](heavy-1.json) |
| 1: Corrective scopes | 506 / 0 / 0 / 1 | 2423.3 | [heavy-1-final.log](heavy-1-final.log), [metadata](heavy-1-final.json) |
| 1: Final client-seams/search repairs | 73 / 0 / 0 / 0 | 1223.7 | [heavy-1-repair.log](heavy-1-repair.log), [metadata](heavy-1-repair.json) |
| 2: Initial snapshot | 4,462 / 6 / 9 / 1 | 5122.9 | [heavy-2.log](heavy-2.log), [metadata](heavy-2.json) |
| 2: Corrective scopes | 506 / 0 / 0 / 1 | 2400.4 | [heavy-2-final.log](heavy-2-final.log), [metadata](heavy-2-final.json) |
| 2: Final client-seams/search repairs | 73 / 0 / 0 / 0 | 1196.9 | [heavy-2-repair.log](heavy-2-repair.log), [metadata](heavy-2-repair.json) |
| 3: Initial snapshot | 4,461 / 7 / 9 / 1 | 5122.5 | [heavy-3.log](heavy-3.log), [metadata](heavy-3.json) |
| 3: Corrective scopes | 506 / 2 / 0 / 0 | 2404.0 | [heavy-3-final.log](heavy-3-final.log), [metadata](heavy-3-final.json) |
| 3: Final client-seams/search repairs | 73 / 0 / 0 / 0 | 1248.4 | [heavy-3-repair.log](heavy-3-repair.log), [metadata](heavy-3-repair.json) |
| 4: Initial snapshot | 4,460 / 8 / 9 / 1 | 5123.2 | [heavy-4.log](heavy-4.log), [metadata](heavy-4.json) |
| 4: Corrective scopes | 507 / 1 / 0 / 0 | 2234.2 | [heavy-4-final.log](heavy-4-final.log), [metadata](heavy-4-final.json) |
| 4: Final client-seams/search repairs | 73 / 0 / 0 / 0 | 1210.6 | [heavy-4-repair.log](heavy-4-repair.log), [metadata](heavy-4-repair.json) |
| 5: Initial snapshot | 4,463 / 5 / 9 / 1 | 5123.0 | [heavy-5.log](heavy-5.log), [metadata](heavy-5.json) |
| 5: Corrective scopes | 507 / 1 / 0 / 0 | 2370.4 | [heavy-5-final.log](heavy-5-final.log), [metadata](heavy-5-final.json) |
| 5: Final client-seams/search repairs | 73 / 0 / 0 / 0 | 1376.6 | [heavy-5-repair.log](heavy-5-repair.log), [metadata](heavy-5-repair.json) |
| Unconfined: all affected files | 4,519 / 0 / 9 / 0 | 849.7 | [final-unconfined.log](final-unconfined.log), [metadata](final-unconfined.json) |
| Complete scripts/test.sh, once | 5,814 / 0 / 10 / 0 | 1403.6 | [whole-suite.log](whole-suite.log), [metadata](whole-suite.json) |

The table counts Node tests, including the separate model stage. Each initial run has one intentional cancellation: its obsolete model stage was stopped after the ordinary stage completed and is replaced by the full final model run. Its partial model result is not credited. The complete script also executes Rust tests, builds, typechecks, wasm checks and witness tests. The script’s exact summary is:

```text
== 0 failure(s) in 1404 s
```

The complete script reports **4,442 Rust tests passed, 0 failed and 33 ignored**. Its wasm budget check also passes: wasm 1994357 B raw, 598401 B gzip (budget 598401: ok).

The separately run **whole guide passed 110/110**, zero failures or ignored tests ([guide.log](guide.log)). All 339 `.mjs` syntax checks and source/document whitespace checks passed. Captured logs and extracted failure text retain their original whitespace. Linux-only qualification retains the existing Darwin skips; the manual external identity-provider qualifier was audited but requires external credentials and was not run. Its local proxy tests are covered. This report does not claim Mac-only execution or publication qualification.

## Hang-guard controls

Only a disposable scratch copy of `dist/local.js` was mutated, at the fallback publication boundary. The reached marker, patches, source hashes, commands and results are in [controls.json](controls.json) and [METHOD.md](METHOD.md).

- Delay publication by 15 real seconds: **pass**, 15.939 seconds overall ([log](delayed-publication.log)).
- Withhold publication until cleanup: **expected failure**, 125.061 seconds overall ([log](missing-publication.log)): `TEST_HANG: new branch obtains a current whole-server answer while sync remains held; 2 work unit(s), 124001 ms elapsed, 124000 ms guard`.

The original checkout’s product files were never mutated. The scratch product was restored afterward.

## Failures and disposition

Every failed diagnostic, invalid selection/control, loaded failure and correction is listed in [FAILURES.md](FAILURES.md). The following table identifies every failing test in the initial and corrective snapshots. Each is superseded only by the five passing final runs of its file.

| Initial run | Failing test | Classification |
|---|---|---|
| 1 | 1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders | Baseline fixture race, corrected |
| 1 | process: unknown apply refresh drains after the watermark | Baseline fixture race, corrected |
| 1 | stopped full-release restore preserves its recovery point and stays separate from the original | Baseline fixture race, corrected |
| 1 | unread range wasm: sequence-short-range-large-window | Environmental transport, fixture corrected |
| 1 | unread range wasm: short-range-large-window | Environmental transport, fixture corrected |
| 1 | wasm: pending cut preserves transition before sync publication | Baseline fixture race, corrected |
| 2 | 1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders | Baseline fixture race, corrected |
| 2 | closing the last owner during backoff cancels the next stale-response request | Baseline fixture race, corrected |
| 2 | process 1,000 rows: known apply, empty apply, unrelated apply and duplicate hooks | Baseline fixture race, corrected |
| 2 | stopped full-release restore preserves its recovery point and stays separate from the original | Baseline fixture race, corrected |
| 2 | unread range wasm: meter-cut | Environmental transport, fixture corrected |
| 2 | wasm: pending cut preserves transition before sync publication | Baseline fixture race, corrected |
| 3 | 1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders | Baseline fixture race, corrected |
| 3 | dev declares two workers, injects usable secret seats, restarts independently and stops both | Baseline fixture race, corrected |
| 3 | stopped full-release restore preserves its recovery point and stays separate from the original | Baseline fixture race, corrected |
| 3 | unread range wasm: meter-cut | Environmental transport, fixture corrected |
| 3 | unread range wasm: sequence-short-range-large-window | Environmental transport, fixture corrected |
| 3 | unread range wasm: short-range-large-window | Environmental transport, fixture corrected |
| 3 | wasm: pending cut preserves transition before sync publication | Baseline fixture race, corrected |
| 4 | 1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders | Baseline fixture race, corrected |
| 4 | mutate waits for outbox persistence before the exit transport can see it | Baseline fixture race, corrected |
| 4 | same-epoch logout tombstone refuses live admission | Baseline fixture race, corrected |
| 4 | stopped full-release restore preserves its recovery point and stays separate from the original | Baseline fixture race, corrected |
| 4 | unread range wasm: meter-cut | Baseline fixture race, corrected |
| 4 | unread range wasm: sequence-short-range-large-window | Environmental transport, fixture corrected |
| 4 | wasm: pending cut preserves transition before sync publication | Baseline fixture race, corrected |
| 4 | web admission review: recovery and transport respect the session boundary | Baseline fixture race, corrected |
| 5 | 1,000 per-row useQuery hooks: a relevant write renders revalidating answers with zero loading renders | Baseline fixture race, corrected |
| 5 | ordinary search generated oracle wasm: 300 seeds | Environmental transport, fixture corrected |
| 5 | stopped full-release restore preserves its recovery point and stays separate from the original | Baseline fixture race, corrected |
| 5 | unread range wasm: meter-cut | Environmental transport, fixture corrected |
| 5 | wasm: pending cut preserves transition before sync publication | Baseline fixture race, corrected |
| 1, corrective snapshot | ordinary search generated oracle process: 300 seeds | Ours, aggregate work undercount corrected |
| 2, corrective snapshot | ordinary search generated oracle process: 300 seeds | Ours, aggregate work undercount corrected |
| 3, corrective snapshot | ordinary search generated oracle process: 300 seeds | Baseline fixture adoption race, corrected |
| 3, corrective snapshot | packages/snapback4/test/client-seams.test.mjs: asynchronous HTTP-parser error after app-online | Ours, timer fixture corrected |
| 4, corrective snapshot | packages/snapback4/test/client-seams.test.mjs: asynchronous HTTP-parser error after app-online | Ours, timer fixture corrected |
| 5, corrective snapshot | packages/snapback4/test/client-seams.test.mjs: asynchronous HTTP-parser error after app-online | Ours, timer fixture corrected |

Final affected-file, contention follow-up, guide and complete-suite failures: **ours 0; baseline 0; environmental 0**. The deliberately withheld-publication failure is a successful negative control. Initial implementation mistakes remain attributed to WB in the failure ledger.

One journal entry accompanies this test-only commit. Nothing was pushed or published.
