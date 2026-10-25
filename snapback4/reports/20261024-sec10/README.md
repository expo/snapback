# SEC10 — structural approval inference

The semantic revision is `ab8734c07e9f238bdbf877f44066407d64edd550`, independently marked READY by Muse and a fresh Codex session. [Review provenance](../../../llp/reviews/3000.036.004.000-sec10-r52.provenance.json) binds the verbatim reviews, brief and frozen delta. `origin/main` through `4c6b386072` merged as `669cb5549d`. The incoming Postgres flights, group-collection scheduling and reader-factory work left SEC10 inference/replay code unchanged. The final affected receipt covers the integrated branch; the recorded native evidence remains bound to its frozen SEC10 source and default SQLite profile. Product version remains 0.4.40, with visible changes recorded under 0.4.41 / Guide changes.

The measured Linux x86_64 default SQLite native has SHA-256 `98778a8b1fec77f1ab308383f485f74c69ecd7e716f0999cfdf3db133dc98ce5`. Baseline is the immutable packed npm `snapback4-linux-x64@0.4.40`; its integrity is recorded in the evidence manifest. App archives were read only; every attempt ran on an automatically removed copy. Measurement summaries omit argument payloads and credentials.

## Calibrated findings

Calibration contains 15 medium report entries in 12 lanes; 025 F1/F2 explicitly describe the same hole. The table therefore uses 14 unique holes and preserves both 025 operation witnesses. The prose bakeoff's lane count differs. All six approval classes are refused or gated with no authored invariants, on both fresh deploy and deploy after test. Nine of the fourteen unique holes have automatic schema-inferred coverage; the other five do not encode the missing domain requirement in their original schemas.

| Finding | Original schema, no intent | Explicit requirement / repair |
|---|---|---|
| 002 F1 | Calendar/time advice | Fixed 182-day operation intent has a replayed witness; this is not an exact six-calendar-month anniversary proof. |
| 008 F1 | Refused: child advance outside parent phase | `advanceWall` parent-state witness. |
| 008 F2 | Refused: parent completes unfinished children | `finishJob` child-stage witness. |
| 018 F1 | Refused: sibling approval bypass | `addRescan` witness; the additional historical spec line has no separate exact-site witness. |
| 020 F1 | Individual unused-approval review gate | Require the matching approval or acknowledge this exact informational record. |
| 024 F1 | Text-evidence / presence questions | Six text-to-image type replacements plus one independent presence intent produce three existing upload review gates. The text names alone do not declare mandatory photos. |
| 025 F1/F2 | Refused: retry and fresh-creation bypass | Both `retest` and `logExam`; repeated `retest` also has a one-use-guard witness. |
| 031 F1 | Anchored-window advice | Independent window intent has a replayed witness. |
| 033 F1 | Refused: approved consent changes | `signFailing` stale-input witness. |
| 033 F2 | Child-presence question | Independent matching-child intent has a replayed witness. |
| 036 F1 | Individual unused-timestamp review gate | Enforce `modelApprovedAt` or acknowledge the informational record; no separate exact-site witness from the historical added spec line. |
| 045 F1 | Nonblank-justification review gate | `trim(value) != ''` or existing positive text minimum. Existing stores and text semantics are unchanged. |
| 046 F1 | Individual separately authorized approval-record gate | Require the matching record or acknowledge its exact informational purpose. |
| 049 F1 | Private-media-content question | Independent audience intent has a replayed witness; the tool cannot infer image contents from its type. |

The no-intent matrix also includes 034 (the global-unique advisory item), outside the fourteen medium holes. The twelve historical wave-26 one-line variants all refuse; ten have exact added-spec witnesses, while 018/036 already refuse or gate structurally. The extra 024 F2 variant is retained separately from the medium-hole denominator.

SEC9's 48 variants were remeasured on the same binary. All nine previously demonstrated requested specification cases are caught: 007 F2, 008 F1, 011 F1, 029 F1, 033 F1, 036 F1, wave-25 015 F3, 036 F2 and 043 F1. Across the broader sixteen spec hypotheses, fifteen have witnesses; 015 F2 remains unproved. The 029 weight hypothesis uses the actual edit boundary; 002 uses the actual order operation boundary. Neither correction is silently presented as the original misplaced invariant.

## False-positive survey

All 600 source hashes match the packed 0.4.40 baseline. [The classified comparison](evidence/comparison.json) records **zero false gates and zero false refusals**, no timeouts and no unexplained failures. There are 37 new individual review gates (32 unused approvals, 5 nonblank guards), 6 new deployment FIX identities and 7 new test FIX identities. All are classified genuine. 41 additional projects refuse fresh production deployment and 39 refuse after test; the union counts overlap review and replay findings.

The source-reviewed gate catalog binds exact wave, app, code, source site and message, including multiplicity. An informational unused approval is a genuine review question under S1, not a claimed exploit. New replayed refusals are classified by actual operation and candidate; an unseen refusal or infrastructure failure stays pending rather than being automatically called genuine. Fresh and post-test deploys are both measured. Partial and superseded surveys are not qualification evidence.

The superseded R45 survey exposed two false deploy FIXes and three false test FIXes in wave21-019. Route edit metadata had been treated as an approval event. The repaired implementation shares typed event classification across inference, replacement checks and receipt restoration; nested populations retain their own field types. R45–R51 are not qualification evidence. Independent refinements also retain Boolean polarity, nested population scope and uncertainty for approvals born and deleted within a transaction. The private history retains at most 64 snapshots; an exhausted deletion history stays unknown, never FIX.

Additional controls on the same final binary: vacuous Boolean approval (2,597 attempts, no reachable violations), inline replacement revalidation (2,870 attempts, no reachable violations), and the OR/caller-fact source (check, fresh deploy, test and post-test deploy all exit zero).

## Qualification boundary

The exact final integrated affected receipt, test counts and cleanup record are in [WORKSTREAM-REPORT.md](../../../WORKSTREAM-REPORT.md). This evidence packet is not a publication qualification.

The affected plan retains complete core, language and CLI package tests, the two installed packed security consumer files, client typecheck, release-feature guards, client/Wasm builds, product docs and diagnostics, root inventories/generated artifacts/guide checks, reference validation and the canonical Wasm gzip measurement. Its saved unadjusted plan explains the brief-authorized scope correction: the root closed ticket and shared publication support otherwise select the prohibited full seven-crate / client pool. No parser, planner, stored schema or production wire semantics changed, so the language/store difftest exception does not apply.

The complete new security-guide recipe is exercised as written from installed client and native tarballs. No new starter was added. Mac runs are intentionally skipped: Studio is unreachable and M5 is reserved for publication. Integration 25/publication owns full suites, difftest 20k and qualify-linux.

These are finite replay, admission and review-gate results, not arbitrary all-history security proofs. Cuts and unresolved mappings stay explicit. Same-table dereferenced replacement predicates deliberately remain unknown when snapshot correspondence is not established, even for a stable peer the table-granular analysis cannot distinguish. Nondefault fixture hosts without SQLite are not qualified by this native run. No push, version bump or publication was performed.
