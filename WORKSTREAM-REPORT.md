# SEC4 workstream report — complete

Branch `sb4-b18-sec4`, base `068a57f578` (Integration 18 / 0.4.34). Initial status was clean with no workstream commits. Changes are committed locally; no push or version bump. [Final evidence](snapback4/reports/20261019-sec4/evidence/README.md) contains measured outputs, exact intent, hashes, compact receipts and logs. The previous Integration-18 report is preserved there verbatim.

## Changes and commits

| Item | Implementation | Commits |
| --- | --- | --- |
| 1. Independent intent | README, starters (including plain/online), production recipe and security guide express actor/action/column intent. Equivalent invariant/rule pairs receive `N_INVARIANT_RESTATES_RULE`, a spec-oriented suggested rewrite, and remain advisory. Draft generation emits per-role/per-column questions for confirmation, never active rule copies. Equivalence requires proof in both directions; uncertainty is not equality. | `486dc0cefb`, `db64cba964` |
| 2. Fixture-free tests | Two proposed principals per role/seat, independent principal fields, ownership/membership/reference rows, typed alternative values and verified media. Every generated base/fallback/column/absence world is validated, including final-exists. Empty-store histories also run. Password-only apps use isolated test-only memory; no persistent developer store or closed dev door is needed. Authored fixture/business cases remain supported. | `db64cba964`, `216e96a0dd`, `c4edf21259` |
| 3. Discoverability | One short check block with invariant counts, failing source locations/origins, top five ranked actionable notes with line numbers, omitted-note count, test/audit prompts; verbose/JSON retain full detail. Escalation stays visible ahead of oracle/grant noise. Start packet and cheatsheet default to check → test → audit. Added 0.4.35 guide changes without bumping versions. | `db64cba964`, `c4edf21259`, `48e80b2830` |
| 4. Coverage | Actual authored typed payloads count even when return completeness is false; incomplete/nonrepeatable negative comparisons do not. Enum/text/numeric/reference arguments are fairly interleaved across actors. Independent relationship and media worlds expose column disclosures. `update only` handles old/next values without insert intent; `write` retains inserts+updates. Board/private-column lint and source-role escalation filtering fix 019, 021, 041/047. Stability separates ordinary updates from deletes, cascade, maintains and direct/inherited expiry. Private release-preview snapshot survives activation changing SQLite temp_store. | `db64cba964`, `216e96a0dd`, `c4edf21259`, `27ee015f19` |
| 5. Speed | Bounded 4096-entry exact-expression implication memo; cooperative 1.5-second campaign deadline and shared 512 work reservations include histories, mutations and world forks. Exhausted work reports unproved; full test/audit retain broader campaigns. | `db64cba964`, `216e96a0dd` |
| 6. Remeasure | All 50 wave18 fixture-free campaigns, all 200 original schemas, and spec-intent checks/audits on all 11 high lanes; extra relationship and role-faithful campaigns distinguish actual findings from supplemental synthetic observations. | Report/evidence commit |

LLP 3000.036.004 §§13–13.6 documents changed semantics, assumptions, ceilings and failure origins. Eight required independent review rounds were completed; final **Muse READY and fresh Codex READY** for `27ee015f19`, both checking the inherited-expiry and ordinary-update regressions. [Provenance and verbatim transcripts](llp/reviews/3000.036.004-sec4-review-record.md). `48e80b2830` subsequently adds only an output-ranking regression; qualification product bytes are unchanged.

## Measurements

Same-host, same unoptimized dev opt-level-0 profile, including CLI process startup/compile/report, single worker, 50 wave18 lanes:

| Scope | Before median | Final median |
| --- | --- | --- |
| 37 lanes declaring invariants | 39.440 s | **1.624 s** |
| All 50 lanes | 28.789 s | 1.2115 s |

This meets the requested ≤5-second invariant median. The measured baseline differs from the bakeoff's approximate 18 seconds; this comparison uses matching unoptimized dev profiles on the same host. The earlier intermediate 0.624s result used the test profile and is excluded. The packed static-musl binary measures 1.242s invariant median / 0.9235s all-lane median with four workers.

**200/200 original schemas pass default check**, zero observed false refusals: wave15 100, wave16 50, wave18 50. This does not mean every intent is proved.

All **50/50** wave18 campaigns run without authored fixtures, including password-only apps. At least 1,347 attempts per lane. Original snapshots: 46 pass; 011, 025, 026 and 045 refuse. Spec-corrected 011/045 preserve intentionally public counts while protecting private columns; 025 includes its explicitly allowed service seat; these pass. Update-only 010 also passes its corrected-intent run (original final finite campaign happened to pass; `write` still includes inserts). Role-faithful 026 includes legitimate manager reads and retains 16 actual generated violations for off-role managers/routes. No invariants were weakened to hide that finding. Missing authored business cases remain an explicit warning.

## Finding attribution

All seven calibrated H and seven calibrated M findings have a concrete observation or exact escalation note with careful spec intent. “Caught” below includes actual authored operations from validated generated starting states; these starting states are **test assumptions**, not evidence of empty-store initialization. None of the supplemental seed/synthetic observations is credited.

| Lane / finding | Result | Evidence |
| --- | --- | --- |
| 004 F1 H | Caught | Generated `queue` returns another group's custody image/detail. |
| 013 F3 H | Caught | Empty-store `claimFirstSupervisor` trace and exact escalation location. |
| 015 F1 M | Caught | Generated `clearanceDetail` bypasses contractor-area intent. |
| 019 F1 H | Caught | Generated `reportDetail` notes/photos for unassigned sweep board branch; `N_ROLE_WIDE_READ`. |
| 019 F2 H | Caught under generated-state assumption | Six actual copied-landlord `reportDetail` observations violating live rentalUnits relationship. Exact app's transfer operation was not recorded (zero authored transfer histories); not credited as a transfer-then-read trace. |
| 021 F2 M | Caught | Generated `inventoryFor` returns stopped-sale inventory. |
| 026 F3 M | Caught | Spec-role campaign `unitsOf` / `inspectionsOf` disclose to route principals without technician role. |
| 026 F4 M | Caught | Same role-faithful campaign returns payloads to assigned manager principal without building_manager role. Synthetic direct-building observation excluded. |
| 032 F1 M | Caught | Generated `allChallenges` returns unbooked match to staff. |
| 033 F2 M | Caught | Actual one-step `correctBout` update violates upheld-appeal intent, starting in generated upheld-appeal state. |
| 041 F2 M | Caught | Generated `setProfile` changes building grant. |
| 041 X1 H | Caught | Empty-store self-role `setProfile` and exact escalation note. |
| 044 F3 H | Caught | Generated `board` returns private scan; verified media column worlds now work. |
| 047 F1 H | Caught | Exact `registerStaff` escalation note now names operator correctly. Separate empty-store `foundUnit` role-grant trace also fails intent; it is not mislabeled as registerStaff. |

021 F4 is calibrated class d (public listings by spec), excluded. All requested 11 lanes are represented. Full predicates, source/BRIEF hashes, origins, operations and histories are retained in `shipping-highs.json`, the exact compressed check/audit outputs, `019-findings.json` and `shipping-026-spec.json`. No partial/not-caught finding remains under the stated generated-state model; exact initialization/transfer reachability is a documented coverage gap, not a proof claim.

## Verification

- Full Cargo workspace coverage, including the five production crates plus difftest/sim/native: broad `cargo test --workspace --no-fail-fast` ran for its one-hour bound, then remaining device tail, remaining crates and doc tests completed separately. Final CLI unit tests 494 passed / 5 existing ignored; updated check 105, notes 15, day5 7, run_admission 28 and production-init 14 pass. Guide126, histories28, observers13 and final SEC4 **20/20** pass. No unresolved affected product failure. Initial output-contract failures are retained in the broad log; corrected exact targets have final green logs.
- Full client pool: 419 regular files plus two serial model files (initial 7,814 tests); five failed files repaired/requalified. Final official rerun **5/5 files, 63/63 tests**, no live process leak. Generated event-slot traces via the Rust producer first. Existing full-pool logs preserve the initial failures and successful serial models.
- Mac Studio only `~/sb4-ws-sec4`: final source 20 SEC4, 28 histories, 15 notes, 7 day5 tests pass; production build passes; same common-client tarball runs seven starter/recipe cases and installed guide card successfully. Publication laptop untouched.
- Difftest run20k: 20,000 compiled / 1,220,035 executions, zero disagreements/unexpected bind refusals. Devices0–999: 27,922 executions, zero disagreements. Lean run20k: 16,697 passed, 130 mismatches across **four existing CLASSIFIED signatures; zero new signatures** (command exits1, not a blanket green). Lean check passes80 theorem audits,116 examples,7 oracle fixtures; no new lemma, axiom or sorry.
- Fresh packed `qualify-linux --consumer-only` **passes** on Ubuntu24.04 and Alpine via proot, source `27ee015f19`, static binary hash recorded. Seven starter/recipe cases, installed guide card and changed deploy recipe execute verbatim; remaining qualification proof sections pass. This mode avoids forbidden full `scripts/test.sh`; full Rust/client coverage is separate. Receipt explicitly says publicationQualified=false; no publication qualification claimed.
- Wasm: 2,385,842 raw / **727,013 gzip ≤727,513** budget (unchanged). Client build passes.
- Root frozen Bun install, workspace-hoist and generated-artifact setup pass; inventories pass (365 package tests,35 scripts,31 demos,487 publication leaves,162 pages/1937 snippets). Guide22 checks pass,0 skipped/preconditions,121 inherited warnings. Ref-check0errors/0unchecked; docs budget319/320. Final artifact-only pass recorded with evidence.

## Decisions, limits and ownership

Generated fixture origins intentionally supersede the earlier authored-fixture-only failure posture; reviewers approved the explicit assumption model. Every generated world is validated, but finite campaigns cannot establish universal security or initialize every possible role through app operations. 019's exact transfer history remains a specific finite-coverage gap despite its reproduced actual disclosure. Existing Lean classified signatures are retained, not changed in this lane. No runtime semantics or Lean source changed.

DX4 owns staging/provisioning, clocks/tokens, upgrade narration and uploads; QRY owns partial-return and hidden-lookup language semantics. SEC4 observes actual typed payloads without changing those return semantics. Ownership pointers are in the governing docs/JOURNAL. The affected LLP context, templates, guide mirrors, diary0121 and 0.4.35 changelog were reconciled in the code commits.

No push, release, version bump or change to frozen apps. Large build and qualification scratch are removed after retaining compact evidence, fresh package tarballs and verified binaries. The report/evidence commit completes the workstream; finite reachability and pre-existing Lean classifications are the explicit remaining limits.


## Wave-19 coordinator addendum — implementation checkpoint

Merged origin/main first (`4be5ffa59e`). Wave19 analysis tested the earlier
`db64cba964` SEC4 build; the later wave18 fixes are retained and regression-tested.
The new amendment is LLP3000.036.004 §13.7; required Muse and fresh Codex are
both READY for its clarified design. Implementation/renewed qualification are
in progress, not covered by the wave18 receipts above.

Changes: authored fixture read/assertion failures restored; row-empty fixtures
generate; generated payloads execute authored creators; full finite test records
eligible refutations by exact source/fixtures/CLI and bounded check reloads them;
all escalation locations remain visible; rule-changing deploy prints exposure
and a selected-source campaign demand; distinct equal-length operation paths
retain attribution. Conditional retained-grant advice no longer needs an
independent role declaration. Wave19 regression controls cover invalid insert,
recipient role, copied owner/cold approval, negative existence, unchanged optional
columns, empty directories, cache invalidation/preservation, deployment and
registerStaff literal sampling. Twenty original SEC4 tests pass after making
previous generated test populations explicitly insert-admissible; new controls
are being run alongside the complete Rust workspace. Renewed packed, Mac,
client/differential and corpus evidence follows in the final addendum.
