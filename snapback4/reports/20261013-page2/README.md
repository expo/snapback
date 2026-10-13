# PAGE2 qualification evidence — 2026-10-13

Final semantic checkpoint: `24a644c511fc5a6888597af9335d894790eaeb97`.
It includes original planner/lifetime work, pending-publication safety, durable
transaction/snapshot clocks, fully pinned Lean discovery parity, intrinsic-id
typing across competing uniques, and expression-step discovery fences. Later
commits only record budgets, reviews and qualification. Every Cargo invocation
used `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0`.

Planner §15 has two READY [round-12 reviews](../../../llp/reviews/3000.036-page2.r12.brief.md)
at this checkpoint. Time audiences have two READY [round-10 reviews](../../../llp/reviews/3000.036-page2.r10.brief.md)
at `d0e1c30841`, bound to the unchanged lifetime semantics; timed core 21/21
passes again after the planner discovery restoration. Full review provenance
and per-item tests are in [WORKSTREAM-REPORT.md](../../../WORKSTREAM-REPORT.md).

Each final campaign generates/compiles seeds 0–399 with four workers:

```sh
target/release/snapback4-difftest run --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-native-r12
target/release/snapback4-difftest run-devices --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-devices-r12
target/release/snapback4-difftest run-lean --seed 0 --cases 400 --workers 4 --out /tmp/sb4-page2-final-lean-r12
```

- [Native](native.json): 20,619 executions across nine oracles, including 7/7 timed-search future-absence comparisons; zero disagreements/signatures, exit 0.
- [Devices](devices.json): 13,114 executions on Memory/SQLite; zero disagreements/signatures, exit 0.
- [Lean](lean.json): 1,072 executions; 317 passes, 80 explicit unsupported, 3 disagreements under two pre-existing CLASSIFIED pagination signatures; zero new signatures. Exit 1 reports classified disagreements. These diagnoses predate this work in `crates/snapback4-difftest/cases/found/lean--{continuation-next,next}--next~no-next/`. This is not a zero-disagreement Lean campaign.

The separately pinned discovery-unique shape first appears at native seed 715
and Lean 551, outside the common400-case window. Additional one-case campaigns:

```sh
target/release/snapback4-difftest run --seed 715 --cases 1 --workers 1 --out /tmp/sb4-page2-discovery-native-r12
target/release/snapback4-difftest run-lean --seed 551 --cases 1 --workers 1 --out /tmp/sb4-page2-discovery-lean-r12
target/release/snapback4-difftest run-devices --seed 715 --cases 1 --workers 1 --out /tmp/sb4-page2-discovery-devices-r12
```

[Targeted native](discovery-native.json): 394 executions, explicit discovery-unique
coverage and zero signatures. [Targeted Lean](discovery-lean.json): 6 executions,
one actual compared discovery-unique case, zero signatures. [Targeted devices](discovery-devices.json): 4 executions; both stores correctly remain online-only
unknown/incomplete because this source is uncovered. No offline data-equality
claim is made for that case. Both-store branch merge suite12/12 separately passes.

[Wasm receipt](wasm.json) is clean at `10d27f62cc`:2,305,135 B raw /
703,255 B gzip / 531,512 B brotli; budget 703,755 B = measurement + 500 B.
Serializer-family/forbidden-absence audits and locked web build pass; client
package builds against these bytes. This is Linux whole-artifact evidence,
without a Mac or publication claim.

[Final schema survey](final-schema-survey.md) rebuilds the CLI at the final
semantic checkpoint, preserves binary/source/output hashes, and verifies all 50
odd copied schemas: 20 notes/13 schemas become 18 notes/11 schemas. Named copied
evens 002/098 both remain zero. [Original planner report](planner.md) and
[farm aggregate](farm-survey.json) retain complete shape-exclusion accounting.
[Timed-search addendum](timed-search.md) records generation and simulator/device
coverage. [Commit list](implementation-commits.txt) includes implementation and
review history; final documentation/evidence commits follow. No push.
