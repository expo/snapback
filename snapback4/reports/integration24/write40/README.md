# Integration 24: qualification after shared native write-land integration

Product source: `53da2f7b3de6344e2be82a90364815679b4e7533`.
Main incorporated: `a41c2a0d0f73d44e7887e3bb8f1401ecd64f4044`, merge `4dbc981bce`.
The complete earlier snapshots are preserved under `../final` and `../post-main`; their receipts are not relabelled as current runs.

`day-one-projects.tsv` records all 600 projects before/after: gates, fresh production deploy, app test and production deploy after test. Raw JSONL contains verbatim command outputs. The 49 conditional copied-source audits include the exact authored intent/individual decision, and repeated check and both deploy commands. Six conditional app tests remain failed: four stale starter cases and two genuine finite weight-freeze witnesses. They are not passing business-test evidence. Conditional repair decisions do not accept the original authors' intent or modify originals.

The replay covers all 50 production stores in each mode (direct merged upgrade and published 0.4.38 then merged upgrade). Two genuine deploy refusals and one genuine default rollback refusal per mode remain explicit. Only attempted operations enter refusal counts. Every completed rollback/forward cycle has zero hidden v1 IDs and zero hidden rows/newly empty cells in its visibility report.

`difftest` preserves both the 0.4.39 base and candidate reports, worker reports, representative source/findings and command logs. The real Lean oracle returns raw exit 1 for 130 inherited mismatches; identical normalized counts/signatures and 42 representative records establish no new signatures. Timing fields alone are excluded.

`exact` preserves a fresh clean Exact2 origin/main clone receipt, five-file dependency/lock binding patch, both apps' command ledgers/manifests, literal snapback and web-test logs, and owned-server cleanup. The first old-lock setup failure is preserved separately; the corrected metadata/lock setup and full repeat pass. No Exact product code changed.

Linux and Mac client pools hold their source trees clean and their native/SDK/Wasm hashes fixed. The Mac uses only the permitted scratch clone on Mac Studio. Linux PostgreSQL campaigns use an owned socket-only cluster; cleanup evidence records stopped status 3 and no PID file. The final default-native public deploy/serve witness uses its own separate owned cluster and independently verifies all recorded child PIDs absent.

The packed receipt is an installed-consumer qualification from a fresh prepare-client pack, including every lane helper and clean Ubuntu/Alpine consumers. Its publicationQualified:false is intentional: the prohibited full scripts/test.sh is not run. Required source suites are run separately. No npm publication is claimed.

All shell commands have a timeout. Every Cargo invocation carries CARGO_INCREMENTAL=0, CARGO_PROFILE_DEV_DEBUG=0 and CARGO_PROFILE_TEST_DEBUG=0. Original stores are never opened with SQLite: copies exclude ownership/token/control files, and original-store checks use raw bytes only.
