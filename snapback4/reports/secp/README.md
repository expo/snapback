# SECP advisory precision evidence

Qualified native: `473e7433a9c7`, version 0.4.43, SHA256 `566371fccda0622d4bb920856e2a040ccab1540f943198aa0c1f170d5dd52bc8`. No version bump, publication or push.

All 250 schemas of waves26–30 were checked in private disposable copies using the unchanged Integration27 survey runner. Original schemas, credentials and stores were never modified. All before/after source bundle hashes match. Both binaries report 0.4.43.

| Wave | False before | False after | Reduction | Median review decisions before → after | Default check p90 lines before → after |
|---|---:|---:|---:|---:|---:|
| 26 | 544 | 23 | 95.8% | 20.0 → 12.5 | 6 → 6 |
| 27 | 594 | 29 | 95.1% | 22.0 → 14.5 | 6 → 6 |
| 28 | 459 | 31 | 93.2% | 19.5 → 12.0 | 6 → 6 |
| 29 | 471 | 32 | 93.2% | 21.0 → 14.0 | 6 → 6 |
| 30 | 510 | 0 | 100.0% | 20.5 → 13.0 | 6 → 4 |

Wave30: **510 → 0 false advisories**. Waves26–29: **2068 → 115**, **94.44% fewer**. Every selected final message names observed guards and the unproved case in one physical line.

Overall median review decisions: **20.5 → 13.0**. Decisions count current unacknowledged securityReviews, including gated questions, matching the expanded check --review campaign. Gate counts and default rendering are reported separately in summary.json.

False means the source already answers the emitted question; real_question is an open policy/filtering question, not an exploit verdict. Wave30 judgments were authored by an independent manual review of all 50 source bundles and 843 baseline/first-candidate note occurrences, then reconciled by unchanged source-backed diagnostic properties. Every new or mixed property is rejected for manual delta review. Older-wave labels use a source classifier plus 407 manually documented category/representative spot checks, covering every wave/code family; no unresolved fallback remains. Survival/disappearance is never classification evidence.

The full per-occurrence evidence and source hashes are in data/*.json.gz; raw independent audit transcripts and all review rounds are retained. Remaining older-wave false notes are explicitly counted, not relabeled.

## Calibrated question retention

All 54 non-dismissed Snapback findings (M/L) in waves26/28/30 were reviewed. Every one of the 31 findings with a relevant baseline question retains such a question; 23 lacked that question before. Partial question aspects (for example text versus upload, without proving mandatory presence) remain explicitly limited in the full evidence. This is question retention, not complete hole coverage or exploit qualification. Integration27 wave30 exact M-hole gate coverage remains **1/14**.

| Finding | Retained question(s) |
|---|---|
| w26-002F1 | N_CALENDAR_DURATION @ schema.q:95:3 |
| w26-008F1 | N_DERIVED_WRITE_AUTHORITY @ $derived/parent-state/754d5fbc4057b66fb816dde3600c92927483cfcbe41740db8ffe0a0139e7c437/schema.q:151:3 |
| w26-008F2 | N_DERIVED_WRITE_AUTHORITY @ $derived/child-stage/16c68cbdeab94206ae0a04b64feb30dbbbda706306a645e1dfd325e1d3ab28fd/schema.q:157:3 |
| w26-018F1 | N_DERIVED_WRITE_AUTHORITY @ $derived/sibling-approval/8659fc62e316e43a5802e0df26bd7606683cd128ac2f54a99b259f8a84afb039/schema.q:182:10 |
| w26-020F1 | N_APPROVAL_NOT_ENFORCED @ schema.q:108:3 |
| w26-024F1 | N_TEXT_EVIDENCE @ schema.q:38:3, N_TEXT_EVIDENCE @ schema.q:39:3, N_TEXT_EVIDENCE @ schema.q:40:3 |
| w26-024F2 | N_CALLER_TIME @ schema.q:115:10 |
| w26-025F1 | N_DERIVED_WRITE_AUTHORITY @ $derived/repeat-create/b7309e662794afc3369c6d457f05bfb258569f304777e30b79b861b211a29325/schema.q:174:10, N_GUARD_NOT_CONSUMED @ schema.q:174:10 |
| w26-025F2 | N_DERIVED_WRITE_AUTHORITY @ $derived/approval-history/45c341e20643b838f9d857be4564d87583029455f58518c4f61fd8cd95c51cdf/schema.q:174:10 |
| w26-031F1 | N_DEPENDENT_WINDOW @ schema.q:79:10 |
| w26-033F1 | N_DERIVED_WRITE_AUTHORITY @ $derived/schema.q/jobs/customerConsent/update/04b2ecb27d3684a813d41b3f372641835e68a8052b867ce412764f8d78088489:163:3 |
| w26-033F2 | N_CHILD_EVIDENCE_PRESENCE @ schema.q:148:3 |
| w26-034F1 | N_UNIQUE_HIDDEN @ schema.q:18:1 |
| w26-036F1 | N_APPROVAL_NOT_ENFORCED @ schema.q:116:5 |
| w26-045F1 | N_BLANK_TEXT_GUARD @ schema.q:160:3 |
| w26-046F1 | N_APPROVAL_NOT_ENFORCED @ schema.q:158:10 |
| w26-049F1 | N_MEDIA_PRIVATE_FIELDS @ schema.q:34:3 |
| w28-011F1 | N_APPROVAL_NOT_ENFORCED @ schema.q:102:3 |
| w28-011F2 | N_ARGUMENT_GRANT @ schema.q:95:10 |
| w28-015F1 | N_BROAD_READ @ schema.q:86:3 |
| w28-019F1 | N_INSERT_WRITE_INTENT @ schema.q:43:10 |
| w28-023F1 | N_TEXT_EVIDENCE @ schema.q:44:3, N_TEXT_EVIDENCE @ schema.q:45:3 |
| w28-024F2 | N_CALLER_TIME @ schema.q:152:3 |
| w28-036F1 | N_DERIVED_WRITE_AUTHORITY @ $derived/schema.q/figures/likenessScan/update/23ee7f4fe5fc49157e8f4416e4639c0357e184e23536b92e04dd59e3756fa621:90:3, N_DERIVED_WRITE_AUTHORITY @ $derived/schema.q/figures/likenessScan/update/c8047023845790f4080646427934aa6a20329524a8078215d457a397c1038c64:90:3 |
| w28-043F2 | N_CALENDAR_DURATION @ schema.q:112:10 |
| w28-047F1 | N_TEXT_EVIDENCE @ schema.q:25:3 |
| w30-002F1 | N_TEXT_EVIDENCE @ schema.q:25:3 |
| w30-010F1 | N_GUARD_NOT_CONSUMED @ schema.q:165:10 |
| w30-030F1 | N_OPTIONAL_EVIDENCE @ schema.q:34:3 |
| w30-033F1 | N_APPROVAL_NOT_ENFORCED @ schema.q:84:3 |
| w30-033F2 | N_CHILD_EVIDENCE_PRESENCE @ schema.q:84:3 |

The JSON inventory lists all54 findings, including uncovered baselines, exact messages, source excerpts, hashes and narrow coverage aspects. No unrelated note in the same lane is counted as retention.

## Boundaries and verification

LLP3000.036.004.003 is implemented (Integration 28 resolved the original parallel 3000.036.004.001 assignment). Final semantic reviews by Muse and fresh Codex both return READY; verbatim responses and rejected revisions are under llp/reviews. Source consistency is advisory relevance over authored constructors, never a database invariant or proof over seed/import/restore images. Gate/runtime/witness consumers do not consume these facts.

The lane explicitly prohibits the full crate/client pools. tools/run-affected-scoped.sh invokes the required affected selector on the final commit, runs modified crates and applicable checks, and returns explicit exit95 for prohibited integration/legacy steps. Its receipt must not be reported as a fully green battery. WORKSTREAM-REPORT.md records the final actual results and any inherited legacy prerequisites. Mac is skipped.

## Reproduce

Use ../integration27/tools/survey-final.py with immutable before/after binaries, --waves 26,27,28,29,30 --workers 8 --check-only --default-output. It copies top-level *.q and authored fixture JSONL to private temporary trees, with fresh campaign state. No acknowledgments or stores are copied. Both phases use the same runner.

Run tools/classify-older.py --before <before/results.json> --after <after/results.json> --out <audit-dir>; tools/reconcile-wave30.py --manual <wave30-manual.json> --after <after/results.json> --out <audit-dir/wave30-after.json>; tools/calibration-retention.py accepts SECP_AUDIT_DIR and SECP_AFTER_DIR. tools/summarize.py validates complete label inventories and computes medians/p90s. Compressed inputs are supported by the classification/summary tools. The calibration reducer expects the canonical runner directory layout.

Shared-host timings are recorded for provenance and are not isolated latency or publication claims. Source/code/binary digests bind this qualification; later evidence-only commits do not change its semantic inputs.
