# Integration 16 qualification evidence

Release 0.4.32, integration lane sb4-loop; no push or publication. The root
WORKSTREAM-REPORT.md is the human verdict and source/commit ledger.

- `packed/`: clean-source preparation and consumer-stage receipts. Qualification
  uses consumer-only; it deliberately does not claim publicationQualified=true.
  Required source suites run separately; their final complete logs/results are
  retained beside this report.
- `SURVEY.md`, `summary.json.gz`, `schemas.json.gz`, `survey-binding.json`:
  all150 original schema hashes, both version runs and counts by code. Private
  copies only; the source wave corpora are read-only.
- `difftest/` and `difftest-comparison.json`: the three full campaigns and exact
  oracle-count comparison with committed ccb9f752d1 controls from RULES5.
  Lean exit1 is the known130 mismatches, with no new signatures.
- `wasm-binding.json`: exact rebuilt artifact, GNU gzip budget method and source
  equivalence. Python/zlib compression is not the budget measurement method.
- `commands-final.json`, `exact32-commands.json`: Exact setup and final version-
  confirmed synced/online command ledgers. The final four commands each run once.
- `upgrade-commands.json`, `upgrade-resume-commands.json`, `upgrade-result.json`:
  actual0.4.31 registry pins, adoption, explicit live conversion/rollback and
  real0.4.32 helper/Expo upgrade. The initial stale wrapper attempt is retained.
- `logs/`: compressed complete commands. Failed/superseded/first runs are
  distinguished from final passing repetitions; no fragment is promoted to a
  passing full suite. `scripts/` preserves the bounded execution drivers.
- `mac-initial-unpinned-native.tar.gz`: earlier successful native witness under
  Homebrew Node24.21, retained as an earlier attempt. The final Mac archive uses
  pinned Node24.13.1 and must be used for the final platform verdict. Videos and
  temporary Metro/build trees remain in the authorized scratch clone; receipts
  record video identities. Installed-app preparation is not a publication or
  own-build attestation.

Final result files are `CHECKS.json`, `rust-results.json` and
`clients-results.json`. Final complete logs are `logs/rust-full2.log.gz`,
`logs/clients-pool.log.gz`, `logs/clients-models.log.gz`,
`logs/clients-fixtures.log.gz` and `logs/docs-budget-final.log.gz`. The first
client discovery is separately retained as `clients-first-results.json` and
`logs/first-clients-*.log.gz`; it is not a passing qualification.

`integ16-mac-final-binding.json` verifies all nine changed fenced inputs
against Linux9c3cb5f485. `integ16-final-mac-evidence.tar.gz` retains the final
pinned Mac Rust/client/native logs, complete52-file reruns, five follow-ups,
the enabled published0.2.33 F2 witness, both timing failures and isolation.
The two Mac timing issues remain open; their unchanged guards pass the final
full scope. `packed3/` is the earlier green consumer snapshot; `packed/` is
fresh final qualification4 at9c3cb5f485, with the corrected CLI API index.

Cleanup ledgers cover only exited-PID SQLite sidecars in this integration
worktree and reinstallable node_modules in three superseded consumer outputs.
All raw latest qualification4 outputs and qualified archives remain under
snapback4/target; no publication directory or other worktree was touched.

Final root closeout restored the frozen root install after node_modules was
found absent. Generated prerequisites, inventories, guide22 and ref-check all
pass. The stopped prerequisite-invalid attempt and completed reruns are logged
separately. `MANIFEST.json` records SHA256/size for each evidence file.
