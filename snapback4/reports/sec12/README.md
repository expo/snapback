# SEC12 qualification evidence

The authoritative workstream narrative is `/home/ccheever/projects/sb4-b32-sec12/WORKSTREAM-REPORT.md`.
All original apps remained read-only. Tools copy schema and authored JSONL fixtures;
no copied generated decisions establish a gate or acknowledge one.

## Evidence composition

- `before850.json.gz`: SEC11 committed binary on the 800-schema survey plus wave31's 50 final sources. The baseline source hashes are retained.
- `after850.json.gz`: complete production/after-test attempts on the same 850 sources. The 800-source campaign froze S1/core S3; it has no invented predecessor. Wave31 adds exact day-one sources for check-time release comparison. Later S2 hardening only restricts candidate admission. `qualification-binaries.json` identifies the distinct binaries; this is a composed qualification, not an exact-final-binary 850-schema battery.
- `precision.json`: exact inherited gate/FIX/refusal comparison, with SEC11's source-reviewed classifications as its baseline. New gates correspond only to calibrated 002 F2,014 F4,019 F1. No production refusal or FIX was introduced. Original HTTP watchdog failures are retained and are not product refusals or passing tests.
- `coverage.json`: every calibrated M in waves26,28,30,31 (57), before and after, matched to its actual operation/predicate. Missing effects remain missing; unrelated findings receive no credit. SEC11b's assignment/transition work is outside this lane.
- `integrated-wave31.json.gz` and `integration-comparison.json`: all50 release-relative checks on the final source mechanism after merging main, with no gate/verdict change.
- `release-chain-final.json`: copied002/014/019 immutable same-target deployment sequence, evaluated allowance and schema-fix recovery. The report also identifies the repeated integrated run.
- `evaluable-033.json`: before/prose acceptance, new prose refusal, false invariant refutation, explicit evaluated allowance and live audit. `033-acceptance-89.log.gz` records the fixed app's89-check replay.
- `*-schema.patch`, `*-acceptance.patch`, `fix-forward-*.json`: source repairs and intentionally revised assertions for002/014/019/033.014/019 originally expected the create hole; those original failures remain recorded.
- `consumer-security17.json` and `consumer-starters17.json`: actual packed security/starter consumers on the recorded SEC12 package. The workstream report identifies the repeated post-merge package proofs.
- Test logs and `difftest-*.json`: affected language/CLI/client checks and finite differential runs. Lean retains18 inherited disagreements in three signatures; it is not an all-green claim.

Fresh Muse and Codex source reviews are verbatim under `llp/reviews/3000.036.004.002-*`. S1 round4, S2 round18, core S3 round3 and its projection/presentation rounds4/5 are READY. Earlier failures remain alongside them.

No complete canonical selector receipt is claimed: the brief prohibits the broad Rust/client pools selected by shared documentation. `tools/affected-scoped.mjs` preserves the original plan, selected plan and omitted steps. The final report gives the actual scoped result. Root legacy Snapback1 generated/guide inventories do not apply inside the Snapback4 fence.

Version remains0.4.43, guide changes are under0.4.44, no push/publication, Mac skipped.
