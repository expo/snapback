# Supervisor verification of fix round 1 (final tree, outside the sandbox)

Astra's REPORT.md left the full-device row unfilled while its own `device-full-final.log` showed the `w13g_probe` target failing 44 tests; that log came from an intermediate state of the round. On the final tree:

```text
cargo test -p snapback4-device --test w13g_probe: test result: ok. 142 passed; 0 failed
cargo test -p snapback4-device (full): 1599 passed, 0 failed, 4 ignored (exit 0)
cargo test -p snapback4-core --test progressive_acquisition: exit 0
cargo test -p snapback4 progressive: exit 0
cargo test -p snapback4-sim --test progressive_history: exit 0
cargo test -p snapback4-lang --test guide: exit 0 (139 passed)
bash scripts/build-wasm.sh: wasm 2446527 B raw, 748068 B gzip (budget 739004: OVER by 9064 B) — expected; budget raised at landing
bun run --cwd packages/snapback4 build: exit 0
node --test (volta node 24.18.0): progressive-acquisition 32 passed + 1 browser skip; acquisition 47; ordinary-history 14; retained-history 79; retained-history-cut 14; react 77; progressive-start 48 — all 0 failed
```
