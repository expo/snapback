# Snapback 4: wasm build optimizer follow-ups (lane HV)

Status: Open
Date: 2026-09-29
Systems: `snapback4/scripts/build-wasm.sh`, `snapback4/scripts/measure-wasm.sh`, pinned Binaryen 132.0.0

From Astra's review of HV round 4 (`~/sb4-intent/reviews/hv-r4.astra.md` on eb1000):

1. **P3: measurement checks Binaryen too late.** `measure-wasm.sh:14` runs the Cargo-based census before validating the
   pinned dependency, so an earlier failure can hide the installation hint. Validate first, as `build-wasm.sh`
   does, and extend the missing- and mismatched-dependency tests to measurement.
2. **Discarded work.** Each build spends about 27.6 s on an `-Os` pass whose output is discarded (folding wins; it
   takes 1.7 s). Skip that candidate when it cannot win, or measure it once per toolchain, and keep the selection
   rule honest.
3. **Margin.** The budget margin is 5–424 B, depending on host and gzip. Per the author's ratchet rule, the next
   landing that needs device bytes raises `metrics/wasm-budget.json` in the same commit, with its reason.
