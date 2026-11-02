# Commands and verbatim verification summaries

Run from `snapback4/`; `run.py` records commands, runtime and exit status. The initial HTTP filter matched no tests. Initial Node 25 attempts and the two failed heavy measurements are retained. `LOGS.json` maps the split device log.

## 1. core-initial.log — exit 0

```sh
cargo test -p snapback4-core --test progressive_acquisition
```

```text
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
```

## 2. typecheck.log — exit 0

```sh
bun run --cwd packages/snapback4 typecheck
```

```text
$ tsc -p tsconfig.json --noEmit
```

## 3. wasm.log — exit 1

```sh
bash scripts/build-wasm.sh
```

```text
wasm 2444934 B raw, 747296 B gzip (budget 739004: OVER by 8292 B — issues/20260913-snapback4-wasm-device-diet.md)
wasm budget: the web device exceeds metrics/wasm-budget.json. A landing that needs the bytes raises the budget in the same commit, with the reason in its why, the commit message and the journal (LLP 3000.002; issues/20260913-snapback4-wasm-device-diet.md).
```

## 4. sim.log — exit 0

```sh
cargo test -p snapback4-sim --test progressive_history
```

```text
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
```

## 5. http.log — exit 0

```sh
cargo test -p snapback4 serve_sync::progressive
```

```text
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 785 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 107 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 40 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 45 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 20 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 6 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 27 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 41 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 29 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 56 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 14 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 13 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 21 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 29 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 5 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 8 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 12 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 24 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 58 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 28 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 14 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 29 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 22 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 17 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 14 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 36 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 16 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 11 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 21 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 23 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 15 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 7 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 2 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 23 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 9 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 10 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 79 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 1 filtered out; finished in 0.00s
```

## 6. build-client.log — exit 0

```sh
bun run --cwd packages/snapback4 build
```

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

## 7. core.log — exit 0

```sh
cargo test -p snapback4-core --test progressive_acquisition
```

```text
test result: ok. 13 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
```

## 8. guide.log — exit 0

```sh
cargo test -p snapback4-lang --test guide
```

```text
test result: ok. 139 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.20s
```

## 9. build-cli.log — exit 0

```sh
cargo build -p snapback4
```

```text
warning: function `exposure` is never used
   --> crates/snapback4/src/verbs/security.rs:101:15
    |
101 | pub(super) fn exposure(report:&Report){
    |               ^^^^^^^^

warning: `snapback4` (bin "snapback4") generated 30 warnings (run `cargo fix --bin "snapback4" -p snapback4` to apply 2 suggestions)
    Finished `dev` profile [unoptimized] target(s) in 6m 23s
```

## 10. ordinary-history.log — exit 1

```sh
node --test packages/snapback4/test/ordinary-history.test.mjs
```

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ skipped 0
```

## 11. progressive-acquisition.log — exit 0

```sh
node --test packages/snapback4/test/progressive-acquisition.test.mjs
```

```text
ℹ tests 30
ℹ pass 29
ℹ fail 0
ℹ skipped 1
```

## 12. http-corrected.log — exit 0

```sh
cargo test -p snapback4 --bin snapback4 sync_generation_tests::progressive
```

```text
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 782 filtered out; finished in 0.04s
```

## 13. build-client-node24.log — exit 0

```sh
bun run --cwd packages/snapback4 build
```

```text
$ tsc -p tsconfig.build.json && mkdir -p dist/wasm && cp src/wasm/snapback4_device.js src/wasm/snapback4_device.d.ts src/wasm/snapback4_device_bg.wasm src/wasm/snapback4_device_bg.wasm.d.ts dist/wasm/ && node scripts/pack-recipes.mjs && node scripts/guide-api.mjs
guide api app: 504/2400 tokens
guide api witness: 210/2400 tokens
guide api react: 1191/2400 tokens
guide api proof: 1529/2400 tokens
guide api client: 1165/2400 tokens
guide api auth: 503/2400 tokens
```

## 14. ref-check.log — exit 0

```sh
cd .. && ./ref-check --verbose
```

```text
ref-check: ok — 583 LLP docs, 12983 refs in 51362 files, 0 errors, 0 unchecked
```

## 15. device-progressive-final.log — exit 0

```sh
cargo test -p snapback4-device --test progressive_history
```

```text
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
```

## 16. acquisition.log — exit 0

```sh
node --test packages/snapback4/test/acquisition.test.mjs
```

```text
ℹ tests 47
ℹ pass 47
ℹ fail 0
ℹ skipped 0
```

## 17. retained-history.log — exit 1

```sh
node --test packages/snapback4/test/retained-history.test.mjs
```

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ skipped 0
```

## 18. progressive-start.log — exit 0

```sh
node --test packages/snapback4/test/progressive-start.test.mjs
```

```text
ℹ tests 48
ℹ pass 48
ℹ fail 0
ℹ skipped 0
```

## 19. typecheck-node24.log — exit 0

```sh
bun run --cwd packages/snapback4 typecheck
```

```text
$ tsc -p tsconfig.json --noEmit
```

## 20. ordinary-history-node24.log — exit 1

```sh
node --test packages/snapback4/test/ordinary-history.test.mjs
```

```text
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ skipped 0
```

## 21. progressive-acquisition-node24.log — exit 0

```sh
node --test packages/snapback4/test/progressive-acquisition.test.mjs
```

```text
ℹ tests 30
ℹ pass 29
ℹ fail 0
ℹ skipped 1
```

## 22. device.log — exit 0

```sh
cargo test -p snapback4-device
```

```text
test result: ok. 71 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.35s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 6.71s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 22 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.93s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.31s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.45s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 30 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s
test result: ok. 440 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 146.51s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 0 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 21 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 202.28s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.36s
test result: ok. 9 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 1.68s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.73s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.82s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 3.78s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.38s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.18s
test result: ok. 90 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 12.20s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 16 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.64s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.13s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.61s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.48s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.91s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.87s
test result: ok. 5 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.05s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.53s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 0 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.00s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 11 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.14s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.18s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 88 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 1.99s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.33s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.20s
test result: ok. 110 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.86s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.22s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.19s
test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.16s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 24 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.61s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 251.26s
test result: ok. 14 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.32s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.77s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.09s
test result: ok. 12 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.15s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 48.21s
test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.11s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.08s
test result: ok. 26 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.24s
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.12s
test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 7 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 8.02s
test result: ok. 6 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.79s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
test result: ok. 142 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 4.45s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.04s
test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.03s
test result: ok. 10 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.59s
test result: ok. 17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.21s
test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

## 23. default-progressive-1.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 1 default
```

```text
{"fixture":"default","mode":"progressive","run":1,"sync":{"pages":6,"acquirePages":3,"snapshotPages":0,"bytes":5384468},"ok":true,"inboxMs":476.4381250000001,"foregroundMs":482.41779199999974,"fullAcquisitionMs":1141.0192499999998,"peakJsHeapBytes":70922152}
```

## 24. default-progressive-2.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 2 default
```

```text
{"fixture":"default","mode":"progressive","run":2,"sync":{"pages":6,"acquirePages":3,"snapshotPages":0,"bytes":5384468},"ok":true,"inboxMs":477.95433300000013,"foregroundMs":485.05991600000016,"fullAcquisitionMs":1123.861625,"peakJsHeapBytes":70787824}
```

## 25. default-progressive-3.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 3 default
```

```text
{"fixture":"default","mode":"progressive","run":3,"sync":{"pages":6,"acquirePages":3,"snapshotPages":0,"bytes":5384468},"ok":true,"inboxMs":486.6720830000004,"foregroundMs":494.33383300000014,"fullAcquisitionMs":1129.2049579999998,"peakJsHeapBytes":70721408}
```

## 26. default-legacy-1.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs legacy 1 default
```

```text
{"fixture":"default","mode":"legacy","run":1,"sync":{"pages":5,"acquirePages":0,"snapshotPages":3,"bytes":5218326},"ok":true,"inboxMs":1121.6250839999998,"foregroundMs":1144.1991670000002,"fullAcquisitionMs":1192.8981250000002,"peakJsHeapBytes":74126880}
```

## 27. default-legacy-2.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs legacy 2 default
```

```text
{"fixture":"default","mode":"legacy","run":2,"sync":{"pages":5,"acquirePages":0,"snapshotPages":3,"bytes":5218326},"ok":true,"inboxMs":1098.5311249999995,"foregroundMs":1123.4675419999994,"fullAcquisitionMs":1173.097917,"peakJsHeapBytes":76535592}
```

## 28. default-legacy-3.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs legacy 3 default
```

```text
{"fixture":"default","mode":"legacy","run":3,"sync":{"pages":5,"acquirePages":0,"snapshotPages":3,"bytes":5218326},"ok":true,"inboxMs":1100.0699999999997,"foregroundMs":1125.1245420000005,"fullAcquisitionMs":1173.3860000000004,"peakJsHeapBytes":76858152}
```

## 29. heavy-progressive-1.log — exit 1

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 1 heavy
```

```text
{"fixture":"heavy","mode":"progressive","run":1,"sync":{"pages":0,"acquirePages":0,"snapshotPages":0,"bytes":0},"ok":false,"peakJsHeapBytes":0,"error":{"message":"witness seed refused: {\"denied\":{\"code\":\"E_INPUT\",\"family\":\"input\",\"message\":\"the request body exceeds its 16777216-byte limit; split it into smaller requests\"}}","stack":"Error: witness seed refused: {\"denied\":{\"code\":\"E_INPUT\",\"family\":\"input\",\"message\":\"the request body exceeds its 16777216-byte limit; split it into smaller requests\"}}\n    at devServer (file:///Users/ccheever/projects/snapback-ph-20261102/snapback4/witness/lib.mjs:85:50)\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)\n    at async file:///Users/ccheever/projects/snapback-ph-20261102/snapback4/reports/20261102-progressive-history-2c/measure.mjs:96:14"}}
```

## 30. heavy-progressive-1-retry.log — exit 1

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 1 heavy
```

```text
{"fixture":"heavy","mode":"progressive","run":1,"sync":{"pages":26,"acquirePages":13,"snapshotPages":0,"bytes":26526848},"ok":false,"foregroundMs":845.9048340000008,"fullAcquisitionMs":6591.141250000001,"peakJsHeapBytes":128288008,"error":{"message":"The expression evaluated to a falsy value:\n\n  assert.ok(out.checkpoints.inbox && out.checkpoints.foreground)\n","stack":"AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:\n\n  assert.ok(out.checkpoints.inbox && out.checkpoints.foreground)\n\n    at file:///Users/ccheever/projects/snapback-ph-20261102/snapback4/reports/20261102-progressive-history-2c/measure.mjs:165:12\n    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)"}}
```

## 31. heavy-progressive-1-corrected.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 1 heavy
```

```text
{"fixture":"heavy","mode":"progressive","run":1,"sync":{"pages":26,"acquirePages":13,"snapshotPages":0,"bytes":26526848},"ok":true,"inboxMs":851.7536250000012,"foregroundMs":862.6141250000001,"fullAcquisitionMs":6593.396499999999,"peakJsHeapBytes":128955056}
```

## 32. heavy-progressive-2.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 2 heavy
```

```text
{"fixture":"heavy","mode":"progressive","run":2,"sync":{"pages":26,"acquirePages":13,"snapshotPages":0,"bytes":26526848},"ok":true,"inboxMs":839.661458999999,"foregroundMs":851.5619169999991,"fullAcquisitionMs":6622.267959000001,"peakJsHeapBytes":129115624}
```

## 33. heavy-progressive-3.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs progressive 3 heavy
```

```text
{"fixture":"heavy","mode":"progressive","run":3,"sync":{"pages":26,"acquirePages":13,"snapshotPages":0,"bytes":26526848},"ok":true,"inboxMs":855.411458999999,"foregroundMs":865.3303339999984,"fullAcquisitionMs":6611.020208999998,"peakJsHeapBytes":128632096}
```

## 34. heavy-legacy-1.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs legacy 1 heavy
```

```text
{"fixture":"heavy","mode":"legacy","run":1,"sync":{"pages":13,"acquirePages":0,"snapshotPages":11,"bytes":25293100},"ok":true,"inboxMs":5338.4053749999985,"foregroundMs":5440.213917000001,"fullAcquisitionMs":5578.367624999999,"peakJsHeapBytes":225559648}
```

## 35. heavy-legacy-2.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs legacy 2 heavy
```

```text
{"fixture":"heavy","mode":"legacy","run":2,"sync":{"pages":13,"acquirePages":0,"snapshotPages":11,"bytes":25293100},"ok":true,"inboxMs":5444.643874999998,"foregroundMs":5574.048290999999,"fullAcquisitionMs":5709.788958000001,"peakJsHeapBytes":225636448}
```

## 36. heavy-legacy-3.log — exit 0

```sh
node reports/20261102-progressive-history-2c/measure.mjs legacy 3 heavy
```

```text
{"fixture":"heavy","mode":"legacy","run":3,"sync":{"pages":13,"acquirePages":0,"snapshotPages":11,"bytes":25293100},"ok":true,"inboxMs":5394.680708,"foregroundMs":5497.193541000001,"fullAcquisitionMs":5624.784208000001,"peakJsHeapBytes":225593608}
```

## 37. default-summary.log — exit 0

```sh
node reports/20261102-progressive-history-2c/summarize.mjs default
```

```text
{"fixture":"default","medians":{"progressive":{"syncRequests":6,"inboxMs":477.95433300000013,"foregroundMs":485.05991600000016,"fullAcquisitionMs":1129.2049579999998,"peakJsHeapBytes":70787824},"legacy":{"syncRequests":5,"inboxMs":1100.0699999999997,"foregroundMs":1125.1245420000005,"fullAcquisitionMs":1173.3860000000004,"peakJsHeapBytes":76535592}},"fullAcquisitionMedianChangePercent":-3.765260707047857,"ok":true}
```

## 38. heavy-summary.log — exit 0

```sh
node reports/20261102-progressive-history-2c/summarize.mjs heavy
```

```text
{"fixture":"heavy","medians":{"progressive":{"syncRequests":26,"inboxMs":851.7536250000012,"foregroundMs":862.6141250000001,"fullAcquisitionMs":6611.020208999998,"peakJsHeapBytes":128955056},"legacy":{"syncRequests":13,"inboxMs":5394.680708,"foregroundMs":5497.193541000001,"fullAcquisitionMs":5624.784208000001,"peakJsHeapBytes":225593608}},"fullAcquisitionMedianChangePercent":17.533757110135827,"ok":true}
```

## 39. diff-check.log — exit 0

```sh
git diff --check
```

```text
(no output)
```

## 40. ref-check-final.log — exit 0

```sh
cd .. && ./ref-check --verbose
```

```text
ref-check: ok — 583 LLP docs, 12985 refs in 51382 files, 0 errors, 0 unchecked
```
