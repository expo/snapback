# Integration 18 — verification record

Product candidate: `865fc1273c`; semantic integration corrections reviewed at
`20cb01ee562bd9750ab26e1fea160511473c5fba`. The later candidate commit changes
only packed-rule fixture preparation. No push or registry publication.

Completed evidence:

- Native difftest: 20,000 cases, 1,220,035 executions, no signatures. Devices:
  seeds 0–999, 27,922 executions, no signatures. Lean: 20,000 cases, 56,917
  executions, 130 findings; fresh base `3653cae823` reproduces identical counts
  in all four signature classes. JSON reports and comparison are retained here.
- All 200 schema checks pass with original source hashes unchanged. The earlier
  150-schema note counts exactly match SEC3 final19; wave18 counts are separate.
- Corrected packed client/Expo preparation is source-bound in `prepare.json`.
  Both fresh Exact apps use that client; all 304 installed dist files in each
  match its tarball. `snapback --rebuild`, `contract migrate` and `test web`
  pass for synced and online apps. Commands, clone and source binding are here.
- Actual0.4.33 Expo/store installation and upgrade pass: package pins, adapt,
  check, typecheck and Expo web export. A separate deployed0.4.33 store with
  declared privacy intent and rollback history preserves data/users and
  repeatedly reactivates retained release2 under0.4.34.
- Both fresh independent round2 source reviews are READY (Muse contributor-high
  via the commissioned Meta fallback, and Codex6.1-sol-high). Verbatim outputs,
  failed quota attempts, identical briefs and provenance are in
  `../../../llp/reviews/integration18/`. Reviews assert no test outcomes.
- Locked Linux wasm:2,385,842 raw /727,013 gzip /548,685 Brotli; budget727,513
  is measurement + exactly500 bytes. Strict family/absence audits pass. Brotli
  uses Node zlib quality11 because the executable is absent.

The final broad Rust/client and corrected packed/Linux/Mac records are still
being collected. This intermediate record does not claim those runs passed.
The Expo native build/witness is blocked by the Studio's Xcode27.1 component
installation requiring administrator authorization; noninteractive sudo is
unavailable. The fresh XCFramework build passed. Final dispositions belong in
the completed workstream report.

Raw logs, qualification work and reproducible command scripts remain under
`~/sb4-loop/integ18/`; Exact work is under `~/sb4-loop/prewave18/`. Disposable
stores/credentials are not repository artifacts. Earlier failed and interrupted
cohorts remain distinguishable from the final complete runs.
