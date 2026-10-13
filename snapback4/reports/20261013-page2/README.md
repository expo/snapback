# PAGE2 qualification evidence — 2026-10-13

Semantic code checkpoint: `1ae0a39c7b0bd323e55128725a20c0d3db0820f4`. Subsequent commits before these campaigns contain budget/journal and review records only. The release difftest binary was rebuilt from this implementation; every Cargo command used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.

Each campaign generated and compiled seeds 0 through 399, with four workers:

```sh
target/release/snapback4-difftest run --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-native-r8
target/release/snapback4-difftest run-devices --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-devices-r8
target/release/snapback4-difftest run-lean --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-lean-r8
```

- [Native](native.json): 21,058 executions, zero disagreements/signatures, exit 0.
- [Devices](devices.json): 13,114 executions on Memory and SQLite, zero disagreements/signatures, exit 0.
- [Lean](lean.json): 1,084 executions; 321 passes, 76 explicit unsupported cases, three disagreements under two pre-existing `CLASSIFIED` pagination signatures; zero new signatures. Exit 1 reports the classified disagreements. Classification and diagnoses predate this work under `crates/snapback4-difftest/tests/lean.rs` and `crates/snapback4-difftest/cases/found/lean--{continuation-next,next}--next~no-next/`. Do not interpret this as a zero-disagreement Lean campaign.

[Wasm receipt](wasm.json) is the clean source measurement at `d491a49a09`: 2,301,467 B raw / 701,506 B gzip, budget 702,006 B = measurement + 500 B. The measurement also passed serializer-family/forbidden-absence audits. This is Linux whole-artifact evidence, not Mac or publication qualification.

[Planner report](planner.md) preserves the lane's checkpoint provenance, exact copied-schema commands, source and output hashes, and complete exclusion accounting. Its campaign checkpoint pointers precede the final repeated campaigns above; the final JSON files here bind the expiry-first fix too. [Farm survey](farm-survey.json) records all 50 odd-lane outcomes: 20 notes in 13 schemas become 18 notes in 11. Even-lane audits of named own-id shapes 002 and 098 both clear their single note.

[Implementation commits](implementation-commits.txt) records the small-step code/design/review history through the final semantic regression and budget commit; documentation/evidence commits follow. Full per-item changes, focused suites, review verdicts and scope boundaries are in the root [workstream report](../../../WORKSTREAM-REPORT.md). Blind semantic review provenance is in `llp/reviews/3000.036-page2.r6.*`.
