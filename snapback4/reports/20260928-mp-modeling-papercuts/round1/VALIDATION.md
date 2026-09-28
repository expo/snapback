# MP round 1 — validation and failure attribution

All Cargo commands run from `snapback4/` (two early equivalent commands used
`--manifest-path snapback4/Cargo.toml` from the repository root). No tools were
installed. Rust 1.97.0, wasm-bindgen 0.2.127, Node 24.13.1; wasm-opt was absent.
No scripts/test.sh run. The full landing suite belongs to the supervisor.

## Commands

- `cargo test --workspace --no-fail-fast --test mp_reproduction --test mp_builder
  --test dev_refusals --test audience_bounds --test audience_bounds_runtime
  --test guide --test read_through --test read_through_review
  --test read_through_transactions --test read_through_sync
  --test read_through_provenance --test sequence_by --test sequence_disclosure
  --test written_by --test disclosure --test meter --test ephemeral`
  → `affected.log`.
- `cargo test -p snapback4-lang --no-fail-fast --test mp_reproduction
  --test audience_bounds --test guide` → `final-focused.log`; final fixture
  hardening keeps the expired capture parent physically stored until the
  execution clock crosses its deadline.
- `python3 reports/20260928-mp-modeling-papercuts/round1/counterfactual.py` →
  `counterfactual-lang.log`, `counterfactual-dev.log`, `mutation-eviction.log`.
  Restores round-1 repairs in `finally`; expected failing tests are evidence,
  not final-tree failures. The baseline is merge `07179b8dd`.
- `python3 reports/20260928-mp-modeling-papercuts/round1/grok-mutations.py` →
  `mutation-witness-table.log`, `mutation-expired-deadline.log`; both mutations
  are removed in `finally`. Source bytes were checked after restoration.
- `CARGO_INCREMENTAL=0 bash scripts/build-wasm.sh` → `wasm.log`,
  `wasm-merged-baseline.log`, `wasm-final.log`. The merged baseline temporarily
  restored only the four changed core source files from `07179b8dd`, then
  restored round 1; the remaining round-1 changes cannot enter device wasm.
- Repository-root `./ref-check --verbose` → `ref-check.log` / final audit.
- `git diff --check`, source line counts, and journal parent-subsequence check.

## Every observed failure and disposition

| Observation | Attribution and disposition |
| --- | --- |
| Initial append command used a root-relative path while cwd was snapback4 | **Ours**, command setup. No file edited; its Cargo run exercised the original 8 MP tests and passed (`baseline-lang.log`). Corrected cwd/path. |
| `baseline-lang-new.log`: 3 failures | **Ours**. Intended sequence false-positive reproduction, plus two new fixtures lacking `immutable parent`. Fixed fixture declarations before claiming capture/expiry evidence. |
| `fixed-lang-1.log`: 2 failures | **Ours**. Source-map collection occurs after through lowering, so matching the original AST call missed the site. Switched to lowered through metadata plus read effect. Aggregate fixture seeded a parent already expired at wall time; changed to future seed deadlines. |
| `fixed-lang-2.log`: same 2 failures | **Ours**, the correction script used the wrong cwd and changed nothing. Corrected paths; `fixed-lang-3.log` passes both targets (21 tests). |
| `fixed-dev-1.log`: 2 failures | **Ours**, test fixtures used `alice` instead of actual loopback persona `dev:alice` for an intended successful insert. Corrected owner values; `fixed-dev-2.log` passes all 4 process tests. |
| First counterfactual helper launch addressed the repository root as the Cargo root | **Ours**, helper setup, failed before edits. Corrected parent index. |
| First counterfactual command stopped after the audience_bounds target | **Ours**, harness omission. Added `--no-fail-fast` and reran to exercise the MP target as well; retained final logs contain every target. |
| Original blocked-stderr test passed the synchronous baseline | **Ours**, insufficient test strength. This host permits 1 MiB pipes. Pinning Linux capacity to 4096 B and issuing 4096 refusals makes the baseline time out while the repaired process completes. No timeout/concurrency weakening. |
| `counterfactual-lang.log`: 6 deliberately failing tests | **Ours, expected** when removing repairs: preview wording; cross-group sequence; missing/expired/unreadable capture; hidden write cause. Existing behavior and committed aggregate expiry test pass on that baseline. |
| `counterfactual-dev.log`: 3 deliberately failing tests | **Ours, expected** on round 0: producer/envelope isolation, ambiguous instance selection and blocked-stderr response timeout. Original eviction still passes. |
| `mutation-eviction.log`: 40 records versus 32 | **Ours, expected** with eviction removed. The final implementation retains add8 through add39. |
| `final-focused.log` and the broad run's metadata case | **Ours**, new fixture used different-length parent IDs, correctly charging different disclosed input heap bytes. Equal-length IDs fix the comparison; final MP retest passes 16/16. The first expired-deadline mutation probe hit this fixture error too; it was rerun after correcting the fixture. |
| `grok-rewrite-before.log` | **Ours, expected**: the old rewrite invents message/ordinal wording for `joinedAt` on `rooms`. Fixed rewrite names the declared model. |
| `mutation-witness-table.log` | **Ours, expected**: removing the same-table guard yields two notes instead of one. Guard restored. |
| `mutation-expired-deadline.log` | **Ours, expected**: injecting the expired parent's raw deadline and emitting both denied aggregate/page scopes leaks next_expiry. Both mutations restored. Grok's suggested note_expiry call excludes expired values, and the outer page scope also discards a denied answer. A preliminary probe that emitted only the inner scope correctly passed; this final probe injects the raw stale deadline and emits both scopes to exercise an actual leak. |
| `wasm.log`, `wasm-final.log` | **Baseline integration budget failure**, reduced by this round: 586,299 B gzip is 106 B above the unchanged 586,193 B ceiling. Same-toolchain merged baseline (`wasm-merged-baseline.log`) is 586,384 B, 191 B above. Round-1 delta is −85 B gzip / −124 B raw. No budget increase and no publication claim. |
| Final staged whitespace check | **Ours**, one new EOF blank line and trailing spaces copied from Astra's original review. Trimmed whitespace only in report/review copies; staged check passes after correction. |
| Read-only exploration commands with stale/guessed file paths, a malformed tail option, and unavailable local skill symlink | **Ours**, command/path errors, no data changed. Located actual module paths and read the skill from coldclone read-only. |

No environmental test failure has been observed. No product test failure is
waived as baseline. All deliberate mutations are absent from the final tree.
The inherited wasm overrun remains an explicit qualification failure.

## Final results

- Broad affected matrix (`affected.log`): **396 passed / 1 failed / 1 ignored**
  across 27 targets, exit 101. The failure is the new unequal-length key fixture
  described above; every other test passes.
- Final corrected MP target after all source mutations were restored
  (`final-mp.log`): **16 passed / 0 failed**, exit 0. No remaining observed
  product-test failure. Do not add overlapping reruns to the broad count.
- Whole compiled guide: **93 passed / 0 failed**, in `affected.log` and
  `final-focused.log`. Focused audience diagnostics: 10 passed.
- Real-process dev/serve tests: **4 passed / 0 failed** in the broad run,
  including blocked stderr, simultaneous fresh stores and >32 records.
- One pre-existing ignored test: DG's full calibration store job/preview oracle
  needs `DG_STORE` pointing at an owned writable copy. No full-store claim.
- Final wasm build: **2,020,060 B raw / 586,299 B gzip**, exit 1 because the
  unchanged budget is 586,193 B. Merged baseline: 2,020,184 / 586,384 B,
  also exit 1. Delta −124 raw / −85 gzip; inherited overrun reduced 191 → 106 B.
  SHA-256 `2fac20835e0f4f2eb344a7b751dc89dab87d9d216443466a3630d3d1c3dbb967`.
- Both merge-parent journals preserved in order; changed source line caps and
  whitespace checks pass. Final reference-audit output is in `ref-check-final.log`.
