# SEC4 workstream report

The wave19 addendum below supersedes the earlier wave18 finding attribution and qualification scope. Earlier results remain historical evidence; they are not extended to later semantic changes.

Branch `sb4-b18-sec4`, base `068a57f578` (Integration 18 / 0.4.34). Initial status was clean with no workstream commits. Changes are committed locally; no push or version bump. [Earlier wave18 evidence](snapback4/reports/20261019-sec4/evidence/README.md) contains measured outputs, exact intent, hashes, compact receipts and logs. The previous Integration-18 report is preserved there verbatim.

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

The earlier closeout credited seven calibrated H and seven calibrated M findings under its then-current generated-state model. The wave19 addendum withdraws four M credits after stronger creator/guard admissibility; the following table preserves that historical attribution for comparison. “Caught” below includes actual authored operations from validated generated starting states; these starting states are **test assumptions**, not evidence of empty-store initialization. None of the supplemental seed/synthetic observations is credited.

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

021 F4 is calibrated class d (public listings by spec), excluded. All requested 11 lanes are represented. Full predicates, source/BRIEF hashes, origins, operations and histories are retained in `shipping-highs.json`, the exact compressed check/audit outputs, `019-findings.json` and `shipping-026-spec.json`. That earlier closeout credited every finding under its stated generated-state model. Current caught/not-caught judgments and actual transfer evidence are in the wave19 addendum below.

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


## Wave-19 coordinator addendum

Merged origin/main first (`4be5ffa59e`); no push or version bump. Read the
wave19 security analysis and fix list. All evidence applications were inputs
only; the harnesses copy `.q` sources into automatically removed scratch.
LLP3000.036.004 §13.7 governs this correction.

| Coordinator item | Change | Main commits |
| --- | --- | --- |
| 1. Authored catches fail | Initial authored seed/fixture read and integrity defects are failing observations even without an initialization history. Synthetic-only observations remain supplemental. | `bde5d560e4` |
| 2. Empty fixtures | Empty or absent fixture inputs both select automatic populations. Private snapshots preserve exactly consumed fixtures, including followed symlink contents. | `bde5d560e4`, `b7685e4d03` |
| 3. Check remembers test | Matching full-test positive evidence carries into check, keyed by exact consumed source/fixtures/executable. No proof/pass is cached. Source races, stale fixtures and stale executables invalidate; duplicate snapshots are bounded without a silent read cutoff. | `bde5d560e4`, `b7685e4d03`, `afcff3d2d7`, `1310cf2c8c` |
| 4. Escalation visible | Every escalation location survives the short-note cap, with effective authority determining the target role. Retained-grant advice stays conditional and available without a separate role invariant. | `bde5d560e4`, `8422ad9162` |
| 5. Generated false positives | Generated payloads execute authored creators and preserve recipient checks, copied values and guards. Column alternates conservatively preserve alias/related-write coupling and existing hub state. Authority rosters require an actual schema gate, not just a principal key plus payload `role`. Bootstrap proposals execute the complete ordinary insert path, including owned-field authority. | `bde5d560e4`, `afcff3d2d7`, `392ba790ad`, `60eeb9a4a8`, `75da99450c`, `6024498db7`, `4249ef8357`, `c4a21db85a` |
| 6. Deploy security loop | Rule-changing `deploy --check` prints exposure and demands a full finite campaign bound to the selected source/fixtures. A matching record satisfies that demand. This is a visible demand, not a new release-activation veto. | `bde5d560e4` |
| 7. Reachable histories | Distinct role/relationship transfers retain actual committed operations followed by the affected principal's observation; equal-length paths keep their own attribution. | `bde5d560e4`, `afcff3d2d7` |

Mixed schemas required an additional real fix: social's ephemeral declaration
had disabled durable fixture forks. Isolated hub copies now preserve rows,
indexes, sequences, deadlines, quota accounting, version/ring state and binding,
without a publisher. Ephemeral memory populations and mutation histories remain
explicitly uncovered and are skipped in every dispatcher. Password-only HTTP
campaigns recognize the existing ephemeral failed-auth envelope without
accepting durable HTTP200, app rule refusals or result/data payloads.
Commits `29b9f64728`, `60eeb9a4a8`, `75da99450c`. No live wire/adoption change.

Final source: **`c4a21db85a`**. Fresh Codex14 is READY on the entire
`4be5ffa59e..c4a21db85a` source delta. Muse13 is READY on the entire §13.7
amendment; its text is identical at that final commit. Earlier NOT READY
reviews and the regressions that resolve them are preserved verbatim with
[provenance](llp/reviews/3000.036.004-sec4-review-record.md). This is source
readiness, not publication qualification. Final evidence is under
`snapback4/reports/20261019-sec4-wave19/evidence/`.

### Final measurements

- **200/200** source-only original schemas (waves15/16/18) pass default check:
  zero observed false refusals. Unproved remains unproved.
- The frozen packed-musl binary's median check is **1.224s** across the37
  wave18 schemas declaring invariants, **0.943s** across all50. The earlier
  matched unoptimized-dev39.440s →1.624s comparison remains historical;
  it is not mixed with the current production profile.
- **50/50** original wave18 campaigns complete with no authored fixtures,
  at least493 attempts each.44 pass;010/011/025/026/032/045 refuse. These are
  not counted as false tool refusals:010's write intent includes insertion;
  011/045 protect intentionally public counts as whole-row secrets;
  025/032 omit an allowed operator seat;026 has actual off-role disclosures.
  Spec corrections010/011/025/032/045 pass. Corrected026 still fails on real
  manager/route role omissions, preserving the intended policy.
- On the10 wave19 repro copies with independent spec intent and **empty**
  fixture directories, all9 real-finding lanes refuse both test and the next
  check:015/019/021/026/032/033/041/044/047. Calibrated class-d034 passes both.
  Witness counts are observations, not distinct bug counts.
- 019's wave18 run has6 observations matching the SAME chimney transferred
  away from the copied landlord, followed by unitReports. Wave19 has10 such
  matched transfer observations and6 committed grantRole→affected-myJobs
  observations. The grantRole caller labelled account:security-no-role is
  already master in that initial world; the defect is retained access after
  an authorized role change, not an unauthorized grant inferred from its label.

### Current finding attribution

Every credited generated observation assumes its validated generated initial
fixture; it is not a theorem about empty-store initialization. Supplemental
synthetic observations receive no finding credit.

| Wave18 finding | Current result | Evidence |
| --- | --- | --- |
| 004 F1 H | Caught | Actual queue returns private coc image/detail. |
| 013 F3 H | Caught | Empty-start claimFirstSupervisor plus exact escalation note. |
| 015 F1 M | Not caught | Equipment/title intents remain unproved; no suitable authored clearance population. |
| 019 F1 H | Caught | Actual reportDetail board disclosure, including photos; role-wide note. |
| 019 F2 H | Caught |6 same-chimney linkUnit→unitReports stale-landlord observations; no invented immutable owner. |
| 021 F2 M | Not caught | Only a synthetic inventory table read; audit correctly exits0. |
| 026 F3 M | Caught | Off-role route principal gets unitsOf data. |
| 026 F4 M | Caught, isolated control | Tightening only the route-read branch in a disposable copy still yields off-role-manager unitsOf failures with unchanged role-faithful intent and no fixtures. |
| 032 F1 M | Caught | Actual allChallenges disclosure. |
| 033 F2 M | Not caught | Upheld-appeal score intents remain unproved in the finite frontier. |
| 041 F2 M | Not caught | Building-update intent remains unproved; self-role escalation is separate. |
| 041 X1 H | Caught | Empty-start setProfile role assignment plus manager escalation note. |
| 044 F3 H | Caught | Actual board returns private scan image. |
| 047 F1 H | Caught | Exact registerStaff note names operator; foundUnit's separate physician self-grant is not mislabeled. |

Thus **7/7 calibrated H and3/7 M** have current eligible evidence. The4 M
misses are explicit follow-up work in
[the finite-campaign ticket](issues/20261019-sec4-finite-campaign-medium-coverage.md).
The earlier claim that every medium was caught is superseded.021 F4/034's
public-by-spec behavior remains excluded; predicates were not weakened to
manufacture passes.

### Renewed verification

- Full Cargo workspace invocation completed (447 reported result batches):6939 passed,
  4 stale expectation failures across3 targets,45 existing ignored. All4
  expectations were corrected and the affected targets passed:guide126,
  security46, histories28. The final native campaign rerun passes
  **28 histories +20 SEC4 +23 wave19 =71/71**. The final check105, notes15,
  day5 evidence7 and CLI wave19's8 controls pass. HTTP/binding units pass4/4.
  Broad unchanged-runtime results are retained; these are scoped affected
  reruns, not a claim of another entire workspace execution at final HEAD.
- Full client pool completed419 regular files plus2 serial model files.
  The initial5 failing files were repaired/requalified: event-slot trace inputs,
  stale wasm declaration output, an isolated maintenance-timer rerun, and the
  packed social zero-work gap. The4-file rerun passes120 with34 existing skips;
  the final frozen packed security file passes3/3. Both serial models pass81/81.
- Mac Studio only `~/sb4-ws-sec4`: final23 wave19 +20 SEC4 +8 CLI +auth unit
  pass; the binding unit also passes after its correction. Core ephemeral18
  controls passed on the unchanged hub implementation. Production build and
  packed installed security card/seven starter-recipe cases pass. All30 changed
  product files match the local final manifest. Common client SHA is
  `6c8bef48806c974e87a300178f43c5ce8d5f028383df6ae28df71671b39fd82b`.
- Difftest20k:1,220,035 executions, zero disagreements/unexpected refusals.
  Devices0–999:27,922 executions, zero disagreements. Lean20k:16,697 pass,
  130 mismatches in4 existing CLASSIFIED signatures, **zero new signatures**;
  it exits1, not a blanket green. Lean audit passes80 theorems,116 examples,
  7 fixtures. No Lean source/axiom/sorry changes. Later checker/fixture-only
  edits do not change these interpreter/planner/oracle inputs.
- Wasm final build passes unchanged:2,385,842 raw /727,013 gzip ≤727,513.
  Client build passes. Root frozen install/hoist/generated setup was completed;
  final inventories,22 guide checks and ref-check pass (121 inherited guide
  warnings,0 skips/preconditions,0 ref errors). An artifact-only rerun later
  hit missing root TypeScript/AJV; frozen install, hoist and generated-artifact
  setup were restored, then inventories and all22 guide checks passed again
  without source/lock changes. Docs budget319/320, named
  self-containment test runs exactly once and passes.
- Fresh packed `qualify-linux --consumer-only` passes on Ubuntu24.04 and
  Alpine via proot, bound to final `c4a21db85a` and the binary SHA in the
  evidence. Installed card, security loops, all starter/frontend, staging,
  production/release/migration/recipe proofs pass. `consumer.json` explicitly
  says suite=not-run and publicationQualified=false; required Rust/client
  coverage is separate, and no publication qualification is claimed.

### Limits and cleanup

Finite creator/argument/history bounds and the4 M gaps are not proofs of
security. Ephemeral mutation histories/populations, disconnected device stores,
opaque native/system paths and unselected longer histories stay explicitly
uncovered. The hub fork enables durable campaigns; it does not claim ephemeral
security coverage. Deploy's rule-change demand is advisory and compares the
four table gates/new/deleted tables; it does not add an activation veto.

Removed this worktree's24GB Cargo target and6GB qualification project tree,
Mac target and packed-project trees, inactive interrupted harness scratch,
its own printed maintenance snapshots and unlocked capture namespace, and
hash-identified superseded temp platform packages. Unrelated/shared temp
artifacts were left untouched. Verified musl/Darwin binaries and fresh packs
remain ignored; compact reports, hashes, receipts and verbatim reviews are
committed. No tests leave live workers or owned scratch behind.

No push, publication or version bump. DX4/QRY ownership pointers remain in the
living docs; no frozen bakeoff application was modified.
