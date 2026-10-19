# Integration 18 — verification record

Product candidate: `865fc1273c`; semantic integration corrections reviewed at
`20cb01ee562bd9750ab26e1fea160511473c5fba`. The later candidate changes only
packed-rule fixture preparation. Later evidence/report commits do not change
product code. Version bump: `77dd50092f`. No push or registry publication.

- Full requested five-package Linux Rust run passes after the last fix:412/412 primary executables,4 doctest groups,6,798 passed / 45 ignored / zero failed. Exact Cargo target census and raw-log binding are in `linux-rust-results.json`.
- Full Linux client pool:419/419 files,7,723 passed / 56 platform skips / zero
  failures. Full-count model cohort:2/2 files,81 passed / zero skips or failures.
  `linux-client-results.json` retains every file, duration and raw-log binding.
- Native difftest:20k cases /1,220,035 executions / zero signatures. Devices:
  seeds0–999 /27,922 executions / zero. Lean 20k:56,917 executions /130 known
  findings, exactly the same four signatures/counts as a freshly built3653cae823.
  `difftest-comparison.json` records the equality and zero new signatures.
- All200 schemas pass on the final merged binary; source hashes unchanged.
  Earlier150 security-note counts match SEC3 final19 exactly. Wave18 counts
  remain separate in `survey-summary.json`; binary binding is adjacent.
- Fresh corrected client/Expo packs are source-bound in `prepare.json`.
  `linux-consumer/` retains the passing packed qualifier results, including
  new release transitions, migration recipe, staging clock and security cases,
  rootless consumers and every frontend starter. Consumer-only qualification
  avoids the forbidden full `scripts/test.sh`; full Rust/client checks are
  separate. Receipt correctly says `publicationQualified:false`.
- Root frozen install/hoist/generated-artifact setup, inventories, ref-check,
  guide 22/22 (zero skips/preconditions), docs budget and RULES4 authoring census
  all pass. Final reference check:zero errors or unchecked refs. Raw-log hashes
  and commands are in `linux-check-results.json`.
- Both fresh Exact apps use the corrected client, with all 304 installed dist
  files in each matching its tarball. `snapback --rebuild`, `contract migrate`,
  `contract types` and `test web` pass for synced and online modes. Exact argv,
  cwd, exits, clone revision and package bindings are retained here.
- Actual0.4.33 Expo/store install and upgrade pass: exact pins, adapt, declared
  invariants, preserved rows, password doors, typecheck and web export. Separate
  deployed0.4.33 history preserves users/data/privacy and repeatedly reactivates
  retained release 2 after rollback; commands and results are here.
- Mac Studio:all 70 client files pass in one cohort (1,650 pass / 15 platform
  skips / zero failures). All affected Rust target sets pass, including the
  list-lower-bounds fixture and bin session diagnostics. Fresh XCFramework,
  Expo prebuild and CocoaPods pass. `mac-results.json` preserves failed early
  scratch/invocation cohorts separately from their successful corrections.
- Both fresh independent round2 reviews are READY (Muse contributor-high via
  commissioned fallback, Codex6.1-sol-high). Verbatim outputs, quota attempts,
  identical briefs and provenance are in `../../../llp/reviews/integration18/`.
- Clean audited Linux wasm:2,385,842 raw / 727,013 gzip / 548,685 Brotli bytes;
  budget727,513 = measurement +exactly500 bytes, with the reason recorded.

**Native qualification remains blocked.** Studio Xcode27.1's component setup
requires administrator authorization; first-launch status69 and simctl listing
cannot complete. A generic Release build stalled in Interface Builder and was
stopped after over 10 minutes without output, using verified owned PIDs only.
No simulator boot, successful Expo Release build or native witness is claimed.
See `mac-native-prerequisite.json` and
`../../../issues/20261019-snapback4-studio-xcode-component-setup-blocks-native-witness.md`.

Complete per-item disposition is in `../../../WORKSTREAM-REPORT.md`.
Raw logs, reproducible runners and disposable qualification work remain under
`~/sb4-loop/integ18/`; Exact work is under `~/sb4-loop/prewave18/`.
Disposable stores/credentials are not repository artifacts. Earlier failed or
interrupted runs are never represented as successful final runs.
