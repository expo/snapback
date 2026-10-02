# Round 4 failure ledger

All development failures below are ours. Expected negative controls are listed
separately. No failure is labeled baseline without a current-main reproduction.

| Run | Failure and resolution |
| --- | --- |
| `affected-first.log` | Four assertions: two tests still read the persisted pending flag; two large properties hit adoption validation requiring cache fields before a recount completed. Tests now inspect private work; stored-cache validation permits only the two missing computed slots, while input/public validation stays strict. |
| `affected-second.log` | Test compile: `KeyProvenance` has no `Default`. Use its explicit `Const` variant. |
| `affected-third.log`, `fields.log` | Invalid test rule compared a principal column with text `'nobody'`, causing `E_QUARRY_TYPE` and consequent `E_SYNC`; eight and two cases respectively fail compilation assertions. Use an admitted parent access witness (generated property) and owner equality (literal). |
| `device-first.log` | Two assertions expected the four-probe review boundary from a public-rule fixture without the review's access witnesses. Restored those witnesses and seeded the grant. The same literal now detects `E_TYPE` on round 3 and passes on the candidate. |
| Base instrumentation `base-production.log` | Production compilation succeeded, but the copy helper assumed `target/debug` already existed in the control worktree. Copied that same completed instrumented production artifact directly; `base-production-recovery.log`. The subsequent dev build and client build pass. |
| Shell/CLI draft probes | One test-file append used the base-build cwd and therefore found no file; repeated at the lane cwd. One CLI probe supplied unsupported `--dir`; repeated with cwd. A diagnostic-only OR-rule probe was refused by `E_SYNC`; it was never added to the fixture. |
| Initial full-suite inventory | `snapback4::scale_row_ranges::live_view_page_and_point_certificates_cover_real_receipts` expected 200 examined units for 100 durable view rows; the new private work-key lookup correctly makes the receipt 300. The CLI certificate still bounded 202, so both its row bound and the exact receipt expectation needed correction. This is ours. The superseded suite was stopped with exit 143 after preserving its logs; it is not a completed full-suite pass. |
| `scale-first.log` | Two new certificate fixtures used an expiring membership witness as source-group authority, an unsupported schema (`E_VIEW_KEY`). The member-only expiry fixture now uses a public source. Final `scale-final.log`: 13/13, including page/point receipts and both computed predicates under both lifetime dispatches. |
| Superseded-suite stop helper | The first PID selector also matched the suite's bash subshells and refused before sending any signal. The corrected selector chose the unique parent in this lane's cwd and recorded it in `initial-suite-stop.json`. |

`affected-fourth.log` passes 55 tests before the raw-schema index regression;
`fields-second.log` passes all three focused field tests. The final lifetime
property with a copied parent authority column passes 13 tests in
`fields-generated-final.log`. Final core cohort: 56/56 in `affected-final.log`.
`device-second.log` passes all 12 device cases and 1,536 independent observations
(768 on each host). Integration passes 28 tests; guide 110 and compatibility 1.

Expected negative controls (`negative-control-round4.py` restores source in
`finally`, no compile errors):

- Exact round-3 product files: read-rule literal fails because the gate row is
  visible before settlement (`round3-rule-negative.log`).
- Exact round-3 product files: both Memory and SQLite fail at four remaining
  probes with `E_TYPE: expected row or map, got null`
  (`round3-device-negative.log`).
- Candidate with only round-3 `witness.rs`: the `recountPending = false` read
  predicate fails against an independently known complete count
  (`flag-certification-negative.log`).

`initial-suite.log` and `initial-suite-partial/` retain the superseded attempt;
the latter includes the actual failing assertion and all parallel logs captured
before shutdown. The final source changes after measurement are only CLI cost
diagnostics and their test (`measurement-source-delta.json`); engine, device and
client bytes remain on the measured source. No measurement attempt failed or was
discarded. Final full-suite outcomes are recorded in REPORT.md; these development
results are not substituted for that final-source run.

Final completed run: **`== 0 failure(s) in 1506 s`**, exit 0. It began after
the last code/test change; all 1,784 captured source/input digests still match.
Final failures: **ours 0, baseline 0, environmental 0**. Rust's complete inventory
and doctests pass; clients 5,745 passed/10 skipped, serial models 79 passed.
No current-main baseline exception was needed. The wasm rebuild is byte-identical
to measurement, 605,215 B gzip within the unchanged 605,225 B ratchet.
