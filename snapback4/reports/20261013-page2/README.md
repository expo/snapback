# PAGE2 qualification evidence — 2026-10-13

Semantic code checkpoint: `47a1d4b098c5108e6acc3800b01c361ce68a74ef`. Subsequent commits before these campaigns contain budget/journal and review records only. The release difftest binary was rebuilt from this implementation; every Cargo command used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.

Each campaign generated and compiled seeds 0 through 399, with four workers:

```sh
target/release/snapback4-difftest run --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-native-r9
target/release/snapback4-difftest run-devices --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-devices-r9
target/release/snapback4-difftest run-lean --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-lean-r9
```

- [Native](native.json): 20,605 executions across nine oracles (including 7/7 timed-search future-absence comparisons), zero disagreements/signatures, exit 0.
- [Devices](devices.json): 13,114 executions on Memory and SQLite, zero disagreements/signatures, exit 0.
- [Lean](lean.json): 1,072 executions; 317 passes, 80 explicit unsupported cases, three disagreements under two pre-existing `CLASSIFIED` pagination signatures; zero new signatures. Exit 1 reports the classified disagreements. Classification and diagnoses predate this work under `crates/snapback4-difftest/tests/lean.rs` and `crates/snapback4-difftest/cases/found/lean--{continuation-next,next}--next~no-next/`. Do not interpret this as a zero-disagreement Lean campaign.

[Wasm receipt](wasm.json) is the clean source measurement at `fa75d82735`: 2,301,917 B raw / 701,899 B gzip, budget 702,399 B = measurement + 500 B. The measurement also passed serializer-family/forbidden-absence audits. This is Linux whole-artifact evidence, not Mac or publication qualification.

[Planner report](planner.md) preserves the lane's checkpoint provenance, exact copied-schema commands, source and output hashes, and complete exclusion accounting. Its campaign checkpoint pointers precede the final repeated campaigns above; the final JSON files here bind the lifetime-aware search and actual-publication fixes too. [Farm survey](farm-survey.json) records all 50 odd-lane outcomes: 20 notes in 13 schemas become 18 notes in 11. Even-lane audits of named own-id shapes 002 and 098 both clear their single note.

[Implementation commits](implementation-commits.txt) records the small-step code/design/review history through the actual-publication regression and budget commit; documentation/evidence commits follow. Full per-item changes, focused suites, review verdicts and scope boundaries are in the root [workstream report](../../../WORKSTREAM-REPORT.md). Blind semantic review provenance is in `llp/reviews/3000.036-page2.r8.*`.

[Timed-search coverage addendum](timed-search.md) records `476c7e4fca`: deterministic native generation, full-outcome absence property, explicit Lean search exclusion, simulator and both-store device cases. The planner report corrects the initial crate attribution of the 57-test branch-merge suite to `snapback4-lang`; a fresh root run passes 57/57.
