# Integration 21 storage-port merge — 0.4.37

Merged incoming main `ad87e0ddb3` into `sb4-loop` in `4414058f21`; the 0.4.37 bump remains. Measurement record: `bf94466fe2`. The prior Integration 21 report is retained in git at `e169452c0c` and in the external evidence directory.

Both journal histories are retained. Activation preserves EVOL table/asset rename interpretation and the migration-only immutable asset root within the adapter's SQLite transaction. New preview operations dispatch explicitly through `store/port/tooling.rs`, including renamed-column before-image paths. The existing asset-loss fixture uses the fallible asset-location port. No owning dereference or raw-handle bridge was restored; SEC5/SEC6 and DX5 stay on their shared paths.

| Final Linux check | Result |
| --- | --- |
| Full five-crate Rust command after the last fix | 7,223 passing executions; zero failures; 47 ignores; 449 result summaries |
| Full client pool | 425/425 files; 7,772 passing tests; zero failures; 56 platform skips |
| Fixture wrapper / full seeded models / TypeScript | 9 fixture tests, 81 full-count model tests, and TypeScript passed |
| Difftest run, 20,000 | 1,222,111 executions; zero signatures |
| Difftest devices, seeds 0–999 | 27,922 executions; zero signatures |
| Lean, 20,000 | Exactly the Integration 21 baseline: 130 disagreements in four signatures (3/35/67/25); no new signatures; 3,173 unsupported cases |
| Fresh pack + qualify-linux --consumer-only | Passed via proot; source `bf94466fe224e36d54862bb940d65a2ca7ffb6ad`; publicationQualified=false |
| 350-schema survey, waves 15,16,18–21 | 350 apps / 358 Quarry files on both the source CLI and exact packed production binary; zero refusals; unchanged inputs and exact note counts |
| Wasm + strict family/absence audits | 2,405,869 raw / 734,907 gzip / 553,447 Brotli B; budget 735,407 B = gzip + 500 B |
| Diagnostics / guide / inventories / censuses | Regenerated; projections unchanged; authoring 872 entries and await boundary 148 files unchanged |
| Root frozen install / hoist / generated artifacts / inventories | Passed |
| Root guide / ref-check / docs budget | Guide 22 passed, zero failures/skips/preconditions; ref-check zero errors/unchecked; README 319/320 lines |

The full Rust run used RUST_TEST_THREADS=8 with incremental and dev/test debug disabled. Counts are reported executions, including nested child reports. Raw logs, all attempt statuses and safe file digests are retained under `/home/ccheever/sb4-loop/integration21-storage`. The first Rust attempt could not compile one legacy asset-path fixture. The first client pass overlapped a wasm/dist rebuild; its failures and dirty-source pack refusal are preserved as invalid attempts. The complete final client pool ran after fresh preparation with stable artifacts. No assertion, timeout, workload, seed count, runtime ceiling or guide budget was relaxed.

Compact evidence: [qualification](snapback4/reports/integration21/storage-port-merge.json) and [file digests](snapback4/reports/integration21/storage-port-evidence-files.json). No requested item is deferred. Mac checks were not required here. This task does not publish npm packages or produce a publication qualification receipt. The final fetch/merge/push result is recorded below after delivery.
