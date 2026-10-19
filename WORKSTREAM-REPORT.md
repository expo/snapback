# SEC3 workstream report

Completed locally on branch `sb4-b17-sec3`, from `3653cae823` (0.4.33). Implementation checkpoint: `bb512f19f4`. No push or version bump. User-visible changes are recorded under **0.4.34 → guide changes**. Measurement, test and consumer receipts are committed in [the evidence index](snapback4/reports/20261019-sec3/README.md).

## Per-item changes

1. **Column-level read invariants (#3).** Added `invariant table.column read only P`, column value/null/presence comparisons through projections, derived/count/existence observers, and effective per-column audiences in `audit`. Committed worlds must retain identical non-protected populations/captures and identical materialized inputs; observations repeat before becoming witnesses. Private null redaction is not disclosure. Commits: `1ef0697bda`, `e9aa1519e7`, `63dfa5e6c5`, `7bccbef743`, `a1f622ce6c`, `53d480551a`. Security, observer, history and packed-guide positive/negative controls pass.
2. **Executable generated tests (#4).** Complete activated SQLite/asset forks preserve maintained rows, captures, recorded deadlines and expiry without re-seeding engine-owned fields. Generated base snapshots omit maintained/recorded fields. Histories use fixture actors, independent principals, references, enum values, real media, time boundaries and post-demotion writes. They replay media creation before revocation and actual empty-start writes. Only authored fixture traces fail acceptance; seed/synthetic observations remain non-failing and visible with `--all`. No-fixture check uses isolated empty memory, explicitly excluding populated production-state coverage. Commits: `95ba44fe77`, `b085776bdc`, `1ef0697bda`, `e9aa1519e7`, `7ae4fbe10c`, `7bccbef743`, `25698ca1c0`, `4a6bc48eee`, `bb512f19f4`. All 27 history regressions and all ten real-app campaigns pass their expected assertions.
3. **Privilege-escalation advice (#5).** Detects structural role/principal grants, self-signup and reassignment; respects independent staff appointers, helper guards, named transitions and actual owned/mixed patch admission. Advice points to STAGE's first-admin recipe. Commits: `1ef0697bda`, `f33f30ede6`, `5a80a0d396`, `e9aa1519e7`, `8c47999548`, `63dfa5e6c5`, `8890094629`. All four requested lanes **002/036/043/048** are flagged; authorized delegation and scoped-enrollment negative controls remain quiet.
4. **Precise notes (#8).** Lifetime advice requires independent current-role intent plus real revocation writers; existence advice requires independent private-existence intent and a distinguishing refusal. Every note has a source location and contributes to counts. Rule printing preserves parentheses. Failing summaries say FAIL and distinguish reachable from supplemental observations. Identity429 carries `Retry-After: 60` and `retryAfterMs:60000`, with HTTP/CORS regression. Commits: `233533e8c6`, `1ef0697bda`, `5a80a0d396`, `a354fbacf2`, `63dfa5e6c5`, `bb512f19f4`. Security and all 15 CLI-note tests pass.
5. **Re-measurement.** Final static production source `bb512f19f4` catches **8/8 calibrated real highs: 0 partial, 0 missed**. Every one of ten reported-high lanes executes **1,024 histories**, with no campaign timeout. All 150 earlier schemas have **zero false refusals**, unchanged source hashes and located notes. Binary SHA-256: `032fe59092b0ee864bac9a939c4e58519fe3f23d7c2ea764a5a6b77c4329f9a8`. Evidence commits: `45adfdb037`, `b6471a3576`, plus the final verification commit. Original app/repro evidence remains read-only.

## Measured findings and noise

| Calibrated root | Result | Responsible operation |
| --- | --- | --- |
| 013 F1 | caught | visibleSubmissions after demotion |
| 019 F1 | caught, read and write halves | inspectionsOf / recordInspection |
| 021 F1 | caught | opponentBrief with wrong deadline binding |
| 021 F2 | caught | createTournament self-director |
| 027 F1 | caught | grantRole |
| 027 F2 | caught | episodesOfShow after demotion |
| 045 F1 | caught | notesFor |
| 048 F2 | caught | logReading(real image) → assignRole → gaugeHistory |

The 021 deadline leak also remains caught on a copy repairing the independent self-director flaw. The ten-lane invariant sets contain additional stricter/miscalibrated declarations; these are retained but are not counted as confirmed highs. Separately hashed field intent for015/027 is recorded with its original-spec provenance.

Without invented independent intent, the 50 wave17 originals produce **0 N_EXISTENCE_ORACLE** (formerly 277) and **0 N_GRANT_OUTLIVES_ROLE** (formerly 155); the 150 earlier originals also produce zero of both. Positive controls exercise the notes when actual declared intent warrants them. Seven escalation advisories in the 150-schema set describe factual authority gains, including first-claim bootstrap/open-enrollment choices; they are delegation advice, not seven automatically confirmed vulnerabilities. No authorized-delegation/scoped-enrollment false advisory was observed. The evidence establishes zero false refusals; it does not mislabel every advisory as a ground-truth exploit.

## Reviews and checks

LLP 3000.036.004 §12 has independent **Muse contributor-high and fresh Codex6.1-sol-high READY**: full-source round 16, nullable-cell delta 17, final empty-start/coverage/packed-proof delta 19. Round 18's ordinary-output caveat request was fixed in bb512f19f4. All actual reviews, earlier NOT READY/capacity attempts, provenance and hashes remain verbatim under `llp/reviews/sec3/`; the readiness manifest links them. Muse's commissioned wrapper used its Meta fallback after plan quota; no key contents were read or printed.

| Check | Result |
| --- | --- |
| Setup | Frozen Bun install, CLI build, wasm and client build pass |
| Full Rust workspace | All requested crates run; four initially failing targets repaired; final full CLI/language rerun **3,638 passed across 236 targets**, 29 intentionally ignored, zero failures; unchanged core/device/sim/difftest/native full targets passed |
| Client pool | **417/417 files pass; 7,713 passing subtests, 56 expected skips, zero failures** (1,817.29 seconds) |
| Full-count models | **81/81 tests pass; no skips; 5,000 online + 5,000 local session sequences and 3,000 online-client interleavings** at unmodified defaults (310.59 seconds) |
| Native difftest20k | **1,220,035 executions; zero disagreements** |
| Devices0–999 | **27,922 executions; zero disagreements** |
| Lean20k |16,697 agree;3,173 unsupported; exactly130 existing findings in the same four signature classes, **no new signatures** |
| Lean build/check |80 standard-axiom audits,116 examples,7 fixtures pass; no sorry/new axioms/new lemmas |
| Fresh packed Linux consumer | Pass in both pinned clean userspaces via proot; security guide/all six starters, identity/session boundaries, staging, recipes and frontend proofs pass; `publicationQualified:false` |
| Mac Studio | Only `~/sb4-ws-sec3`: full affected security/history/observers, CLI notes, session diagnostics pass; final19 empty-start/notes delta also passes |
| Wasm budget |2,380,868 raw /726,039 gzip, below726,502; no budget increase |
| Docs budget | README319/320 lines and self-contained account-screen regression pass |
| Root | Frozen install → hoist → generated artifacts → inventories → guide pass;365 package tests/35 scripts/31 demos/487 leaves; guide22/22, zero failures/skips/preconditions;121 existing gap warnings |
| References |555 LLPs/12,074 refs/zero errors; final delivery check passes |

The original failed/racy cohorts remain distinguishable. Twenty earlier client import failures came from overlapping preparation replacing dist; all 20 recovered (308subtests) on stable bytes, then the final 417 cohort passes independently. An overly short 120s inventory limit was retried with a suitable bounded allowance and passed. No product expectations were weakened for these runs. Consumer-only qualification deliberately avoids the forbidden full `scripts/test.sh`; separate full crate/client checks provide their own receipts and do not manufacture a publication receipt.

## Boundaries, ownership and cleanup

Finite tests do not prove arbitrary application safety. Unsupported opaque dependencies, coupled asset-input column worlds, complex/implicit mutation effects, whole device/wire/activity reductions and arbitrary-history induction remain explicitly unproved. Existing budgets are512 singles/512 pairs;16,384 column call/world reservations;32,768 history-read calls;8,192 whole paired calls;8,192 matrix calls with fair quotas. Unknown never becomes false; weakening requires the existing implication kernel's necessary-condition check. The broader proof-gap ticket remains Open.

REL5 owns release transitions and old-client compatibility. MIG owns data lifecycle/backfills and staging clocks; SEC3's time samples are adversarial inputs only. STAGE owns operator first-admin provisioning.

Owned local Snapback4 target output, Mac target/archive, installed consumer app trees, obsolete binary copies and identified temporary review/test scratch are removed. No owned target executable remains active. Qualified tarballs are retained outside the checkout at `/home/ccheever/sb4-sec3-qualified-artifacts/`, with committed hashes. All commands were bounded; cargo invocations used the required incremental/debug settings. No push, publication or version bump.
