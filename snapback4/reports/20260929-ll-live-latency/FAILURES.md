# Failure ledger

## Initial affected run — ours, corrected

`affected.log`: 440 tests, 409 passed, 31 failed. The tests expected obsolete pre-apply evaluations or a retry timer. They now assert parking and event-driven resumption; their stale-result, timeout, failure and authorization assertions remain. One file waited for an evaluation intentionally removed by the change and was terminated after about 150 seconds (owned PID 1775736). This incomplete run is not counted as passing. Final affected run: 473/473.

- packages/snapback4/test/answers-stay-review.test.mjs
- process: item notification survives readable old replica and failed sync, keep=undefined
- process: item notification survives readable old replica and failed sync, keep=true
- process: item notification survives readable old replica and failed sync, keep=false
- process: item notification survives throw old replica and failed sync, keep=undefined
- process: item notification survives throw old replica and failed sync, keep=true
- process: item notification survives throw old replica and failed sync, keep=false
- process: mixed notification survives readable old replica and failed sync, keep=undefined
- process: mixed notification survives readable old replica and failed sync, keep=true
- process: mixed notification survives readable old replica and failed sync, keep=false
- process: mixed notification survives throw old replica and failed sync, keep=undefined
- process: mixed notification survives throw old replica and failed sync, keep=true
- process: mixed notification survives throw old replica and failed sync, keep=false
- wasm: item notification survives readable old replica and failed sync, keep=undefined
- wasm: item notification survives readable old replica and failed sync, keep=true
- wasm: item notification survives readable old replica and failed sync, keep=false
- wasm: item notification survives throw old replica and failed sync, keep=undefined
- wasm: item notification survives throw old replica and failed sync, keep=true
- wasm: item notification survives throw old replica and failed sync, keep=false
- wasm: mixed notification survives readable old replica and failed sync, keep=undefined
- wasm: mixed notification survives readable old replica and failed sync, keep=true
- wasm: mixed notification survives readable old replica and failed sync, keep=false
- wasm: mixed notification survives throw old replica and failed sync, keep=undefined
- wasm: mixed notification survives throw old replica and failed sync, keep=true
- wasm: mixed notification survives throw old replica and failed sync, keep=false
- process: omitted change tables recover a disjoint local profile, keep=undefined
- process: omitted change tables recover a disjoint local profile, keep=true
- process: omitted change tables recover a disjoint local profile, keep=false
- wasm: omitted change tables recover a disjoint local profile, keep=undefined
- wasm: omitted change tables recover a disjoint local profile, keep=true
- wasm: omitted change tables recover a disjoint local profile, keep=false

## Initial new regression teardown — ours, corrected

`regressions.log`: 24 individual tests passed; the live-propagation file failed after teardown because Node global fetch’s parser callback fired against reset mock timers (`TypeError: Cannot destructure property 'socket' of 'parser.deref(...)' as it is undefined.`). Using the workspace undici fetch and explicitly resetting the mock resolves it. `regressions-final.log`: 32/32.

## Initial guide run — ours, corrected

`guide.log`: 97 passed, 2 failed.

- `client::published_text_needs_no_checkout_or_lane_reports`: reads card linked an inaccessible lane report; removed the link and made the measured scope self-contained.
- `familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block`: total 12,826 words exceeded the unchanged 12,810-word target; condensed the added measurement prose.

`guide-final.log.gz`: 99/99, no limits changed.

## Expected negative evidence

`regression-before.log.gz` rejects baseline obsolete evaluations. The three `negative-*.log` files deliberately fail after dropping a child dependency, apply resumption, or an asset authorization dependency. `negative-controls.json` records assertion exits, not timeouts. These failures prove the regressions detect the fault and are not unresolved product failures.

## Full required suite

`delivery-fault-matrix.test.mjs::every delivery await is explicitly classified` — **ours**. Adding the known footprint changed the `media?.reconcile(...)` await expression without updating its frozen classification record. The census still contains 164 awaits in `local.ts` and the same total delivery sites; only site 7 changes identity. Its `media` recipe, `optional` classification and `absorbs: false` stay unchanged. Updated `delivery-await-boundary.json` and `delivery-fault-sites.json`; the final targeted run passes all 160 transient/persistent site pairs and the classification check.

`mixed-evidence-oracle.test.mjs::mixed evidence schedule process: 300 independent histories` and the wasm counterpart — **ours**, timeout cancellations at 240,116.267044 ms and 240,456.504251 ms. Their `notificationSchedule` helper waited for `reads > 0` while sync was held. The optimized local watch deliberately performs zero such reads. Replaced that wait with the parked-owner state and an explicit zero-read assertion; retained all 300 histories per host, random inputs, deadline, failed-sync, generation, ephemeral and sign-out assertions. No timeout or seed count was increased/reduced.

The worker stayed alive after both test timeouts, preventing the script from reaching its models. Sent SIGTERM to owned test worker PID 2187428 after the two timeouts; the already-ended child PID 2336083 was absent. No unrelated process was stopped. The parent reported 5,227 tests: 5,214 pass, 1 fail, 2 cancelled, 10 existing skips, then continued to the model stage. This is not a green full-suite claim.

Exact full-suite summary: **`== 1 failure(s) in 1555 s`**, exit 1; the failed stage is `client tests`. The subsequent serial model stage passed 79/79. No baseline or environmental test failure was identified. Final targeted validation: **797/797 pass**, zero cancellations/skips, 426,113.587482 ms. Both mixed-evidence hosts ran all 300 histories with `failedSeeds: 0`. This validates the fixes and final source-budget extraction; the full script was not repeated. No unresolved failure remains in the affected scope.
