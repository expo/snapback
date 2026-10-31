# Workstream PUB051 report

**STOPPED before upload**: default progressive web startup leaves 62 avatar hooks denied E_STORE after the device is executable and acquired. Current-main reproduction fails after 122 seconds; same-source awaited-startup control passes. All four npm packages remain latest 0.4.49; 0.4.51 is absent (E404). See [STOP-REPORT.md](/home/ccheever/sb4-pub-0451-records/STOP-REPORT.md) and [STATUS.md](/home/ccheever/sb4-pub-0451-records/STATUS.md).

| Item | Change / commit | Verification / outcome |
|---|---|---|
| Release draft | `6c95ba698ebbf3e1a3798b4e0d85f0adeca2ade6`; mirrored version bump and fixtures, finalized changelog, marked 0.4.50 unpublished | Local only; original affected passed all seven Rust crates, then client fixture red; not a qualified release source |
| Per-row fixture | `a69c65cf161f7eae1bd6e33aba50789ebf16019b` pushed to main | Alone 3/3 x24, exact affected/ref PASS, negative control fails intended cases |
| Upload fixture | `48ec7dd370cb473a7c08417d00042143e515858d` pushed to main | Alone 3/3 before and after main rebase, exact affected/ref PASS; stronger durable-capture assertion |
| Starter dependency audits | Both hosts, prepared preliminary 0.4.51 web/Expo installs | Zero findings, no waiver; not final Mac-native bytes |
| Discovery artifacts | Own stale WASM cache repaired | Matching version checked; sync-generation alone 6/6; both models 89/89 |
| Product stop | No runtime changes | Original/matching-artifact/current-main avatar failures, 62 E_STORE despite ready/acquired, awaited control PASS |
| Publication | No npm publish command run | Latest 0.4.49 all four; 0.4.51 absent all four |

Deferrals: all final-source, native, Linux/Darwin, smoke/audit, finish and registry-byte gates; no successful-publication records commit. Social-browser discovery reds remain unclassified. The coordinator must rule on the product red. Full logs, provenance, exact probe diffs and registry snapshot are retained under `/home/ccheever/sb4-pub-0451-records`. No active owned jobs remain; no other worktrees or sessions were modified.
