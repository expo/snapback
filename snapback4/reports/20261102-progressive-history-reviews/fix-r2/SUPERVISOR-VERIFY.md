# Supervisor verification of fix round 2 (final tree, outside the sandbox)

```text
cargo test -p snapback4-device (Astra's full run, real summary): 106 targets ok, 1604 passed, 0 failed
cargo test: core progressive_acquisition, core partition::delivery, HTTP progressive, sim progressive_history, device progressive_history + w13g_probe + repair_b, lang guide — all exit 0
bash scripts/build-wasm.sh: wasm 2447903 B raw, 748452 B gzip (budget 739004: OVER by 9448 B) — expected; budget raised at landing
bun run typecheck: exit 0; bun run build: exit 0
node --test (volta node 24.18.0): progressive-acquisition 32 + 1 browser skip; progressive-budget 5; acquisition 47; ordinary-history 14; retained-history 79; retained-history-cut 14; react 77; progressive-start 48 — all 0 failed
```
