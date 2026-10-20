# DORM wave-19 replay evidence

`wave19-final.json` replays check/rollback/retained-source forward twice on SQLite backup copies of all eleven dormant lanes. It also adopts an explicit down projection in a copied lane020 source. Original evidence is read-only. `wave19-initial.json` preserves the earlier retained-null failure caught before the final fix; it is not a passing final result.

`user-visibility.json` runs actual authenticated user HTTP queries on copied stores (008 and020), including two declared-down cycles. No account credentials or bearer tokens are recorded.

`differential-summary.json` and the three reports record20,000 native cases,1,000 device cases and20,000 Lean cases. Native/device have no findings. Lean exits1 for130 findings in the four existing open signature classes; no new signature. Named unsupported cases remain unsupported, not passes.

Unchanged-source rollback retains827 dormant rows across the eleven final stores. Nine zero observations in008 cannot fit v1; they are hidden on rollback and restored exactly on forward. Lane020's declared reverse projection restores all twelve previously empty reasons for real old users. Original037 still has three absent labels in its application-managed side table: the application declares a manual fanout mutation, not a historical backfill. The packed required-column migration case proves that declared backfills catch up newly written old-source rows; the engine does not infer a fanout mutation.

Final crate/client/packed/Mac verification and commits are recorded in the worktree-root WORKSTREAM-REPORT.md. No publication receipt is claimed by the consumer-only Linux qualification.

Final validation evidence: `five-crates-summary.json` preserves the original full campaign and its two corrected failures; `language-summary.json` records the complete green language rerun. `linux-consumer-summary.json` binds final packed proofs and verified artifact digests to source 9f49a1faa6. `packed-dormant.json` and `packed-release-transitions.json` name the installed-consumer cases. Mac core/wire/emitter/helper JSONs record assigned-host coverage; root-check and cleanup JSONs preserve the remaining results. Consumer build trees and Cargo targets were removed after verification; exact tarballs, retained binaries and full logs remain outside source as described by WORKSTREAM-REPORT.md.
