# Round 8 commands and evidence

Run from snapback4/ with Node 24.13.1, Bun 1.3.14 and the Cargo environment
in environment.json. No scripts/test.sh invocation. Native/wasm/client builds
precede search/oracle qualification. The wasm command builds the artifact,
then exits 1 at the inherited size cap. Production source is unchanged this
round; later edits expand only the fault-injection harness and its scope.

Every completed logged command is below, with exit and wall seconds. Full
summaries are in run-ledger.json. Baseline interrupted/split matrix commands
are recorded separately in before-runs.json and the report. Split baseline
runs use RG_MATRIX_SITE/RG_MATRIX_MODE and timeout 15s; final qualification
uses every site and both modes, with timeout 60s only as an external watchdog.
The final 313-case run completes in 17.394 s, exit 0, no cancellations.

## affected-delivery — exit 0, 66.226 s

```sh
node --test --test-reporter=tap --test-concurrency=4 packages/snapback4/test/store-reset-review.test.mjs packages/snapback4/test/server-clock.test.mjs packages/snapback4/test/server-clock-recovery.test.mjs packages/snapback4/test/server-clock-regressions.test.mjs packages/snapback4/test/pending-writes.test.mjs packages/snapback4/test/app-local-receipts.test.mjs packages/snapback4/test/app-receipts.test.mjs packages/snapback4/test/legacy-receipts.test.mjs packages/snapback4/test/web-receipt-upgrade.test.mjs packages/snapback4/test/delivery-cas.test.mjs packages/snapback4/test/delivery-publication.test.mjs packages/snapback4/test/delivery-refusal.test.mjs packages/snapback4/test/transport-http.test.mjs packages/snapback4/test/transport-outcomes.test.mjs packages/snapback4/test/store-reset-reconnect.test.mjs packages/snapback4/test/sync-generation.test.mjs
```

## affected-device — exit 0, 55.061 s

```sh
cargo test -p snapback4-device --test device search_merge
```

## affected-rust — exit 0, 21.936 s

```sh
cargo test -p snapback4-sim --test ordinary_search --test membership_search --test search_merge --no-fail-fast
```

## affected-search — exit 0, 41.623 s

```sh
node --test --test-reporter=tap --test-concurrency=1 packages/snapback4/test/astra-arguments.test.mjs packages/snapback4/test/astra-invalid-input.test.mjs packages/snapback4/test/astra-projection.test.mjs packages/snapback4/test/astra-rebirth.test.mjs packages/snapback4/test/cross-scope-review.test.mjs packages/snapback4/test/identity-review.test.mjs packages/snapback4/test/ordinary-search-ledger.test.mjs packages/snapback4/test/ordinary-search.test.mjs packages/snapback4/test/react.test.mjs packages/snapback4/test/retention-pages.test.mjs packages/snapback4/test/review-probes.test.mjs
```

## client-build — exit 0, 2.397 s

```sh
bun run --cwd packages/snapback4 build
```

## controls-expanded — exit 0, 15.892 s

```sh
python3 reports/20260928-os-ordinary-search/round8/controls.py
```

## controls — exit 0, 14.975 s

```sh
python3 reports/20260928-os-ordinary-search/round8/controls.py
```

## guide — exit 0, 38.734 s

```sh
cargo test -p snapback4-lang --test guide --no-fail-fast
```

## matrix-expanded-final — exit 0, 17.463 s

```sh
env RG_MATRIX_OUTPUT=reports/20260928-os-ordinary-search/round8/matrix-expanded-final.json timeout 60s node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
```

## matrix-expanded — exit 0, 17.203 s

```sh
env RG_MATRIX_OUTPUT=reports/20260928-os-ordinary-search/round8/matrix-expanded.json timeout 60s node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
```

## matrix-final — exit 0, 16.494 s

```sh
env RG_MATRIX_OUTPUT=reports/20260928-os-ordinary-search/round8/matrix.json node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
```

## matrix-qualified — exit 0, 17.43 s

```sh
env RG_MATRIX_OUTPUT=reports/20260928-os-ordinary-search/round8/matrix-qualified.json timeout 60s node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
```

## matrix-reindexed — exit 0, 16.358 s

```sh
env RG_MATRIX_OUTPUT=reports/20260928-os-ordinary-search/round8/matrix-reindexed.json timeout 60s node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
```

## matrix-search-query — exit 0, 6.911 s

```sh
env RG_MATRIX_SITE=139,140,141,142,143,144,145,146,147,148,149,150,151,152,153 RG_MATRIX_OUTPUT=reports/20260928-os-ordinary-search/round8/matrix-search-query.json timeout 60s node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
```

## matrix-search — exit 1, 6.918 s

```sh
env RG_MATRIX_SITE=139,140,141,142,143,144,145,146,147,148,149,150,151,152,153 RG_MATRIX_OUTPUT=reports/20260928-os-ordinary-search/round8/matrix-search.json timeout 60s node --test --test-reporter=tap packages/snapback4/test/delivery-fault-matrix.test.mjs
```

## native-build — exit 0, 8.011 s

```sh
cargo build -p snapback4
```

## oracle — exit 0, 302.458 s

```sh
node --test --test-reporter=tap packages/snapback4/test/ordinary-search-oracle.test.mjs
```

## ref-check — exit 0, 3.006 s

```sh
bash -c 'cd .. && ./ref-check --verbose'
```

## typecheck — exit 0, 1.946 s

```sh
bun run --cwd packages/snapback4 typecheck
```

## wasm-attribution — exit 0, 0.383 s

```sh
node scripts/attribute-wasm.mjs --families --check-families --check-absent
```

## wasm-build — exit 1, 0.596 s

```sh
bash scripts/build-wasm.sh
```

## wasm-census — exit 0, 14.292 s

```sh
node --test --test-reporter=tap packages/snapback4/test/wasm-codec-census.test.mjs packages/snapback4/test/wasm-families.test.mjs packages/snapback4/test/wasm-absent.test.mjs
```
