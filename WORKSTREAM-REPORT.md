# SEC7 workstream report

2026-10-22 · branch sb4-b22-sec7 · implementation checkpoint a8fb2ddf9c.
Implementation, measurements and Linux validation are complete. The final Mac
run remains blocked by SSH reachability; the exact limits are recorded below.
No push, no version bump. Version remains 0.4.37; the upcoming 0.4.38 guide-changes
entry is in CHANGELOG.md. DX6 owns release/adoption regressions, staging clocks,
and frontend/proof-kit weight; the engineering journal carries that pointer.

## Commits and design review

- 3ccce67ee7 — §16 amendment and independent design review records.
- 1230377a35 — severity/numeric ordering, grouped result advice, literal/default precision.
- 39a2d8f96d — new classes, individual review gates, bounded histories, guide recipes and regressions.
- 274ea3944b — ordinary code-class shortlist, security explanations and explicit receipt-fixture review.
- ba9fc4c735 — disposition-error explanation and compact-note regression expectations.
- a8fb2ddf9c — compiler-selected typed upsert keys, two-index regression and §16.8.
- 124dc80f2e — guide definition/recovery pins and shifted authoring census.
- 88f2c3e2fa — installed packed why explanations and complete selected-site assertions.

Governing amendment: llp/3000.036.004-security-invariants-and-exposure.rfc.md §16.
Design round 3, implementation rounds 5/6, and final typed-key round 8 each have
independent Muse and fresh gpt-6.1-sol READY verdicts. All actual reviews, including
NOT READY verdicts, are retained verbatim under llp/reviews with model/command/hash
provenance. Round 7's apparent unbalanced brace was a unified-diff interpretation;
applied source compiled and round 8 inspected the balanced actual code. Review
approval never substitutes for test or qualification results.

## Per-item delivery

1. Presentation (1230377a35,274ea3944b,88f2c3e2fa): likely-hole questions lead check and audit; numeric source sites
   sort numerically. Every priority 0–2 question survives the default shortlist,
   followed by five ordinary code classes with all their distinct sites/audiences.
   SEC6 codes never expand that budget. Result advice groups by source table and
   retains full observer/provenance detail in JSON. Default/literal insert fields
   are quiet. IfAbsent results preserve original protected-column lineage too.
2. New classes (39a2d8f96d,274ea3944b): optional creating uploads, empty reasons, omitted money, constant
   approvals/payment flags, generic transition bypass, stale creation eligibility,
   inconsistent duration windows and resource-wide role writes. Naming-based
   classes are explicitly questions, not vulnerability verdicts.
3. Gates (39a2d8f96d,ba9fc4c735,a8fb2ddf9c): N_RETAINED_ROLE_GRANT and N_OPTIONAL_UPLOAD_CREATE fail check pending
   repair or one explicit --ack-security ID --reason decision. Bulk --ack-notes
   cannot clear them. snapback/security-reviews.json binds each note to source,
   analyzer revision and rationale. Unknown/malformed/blank/stale records refuse;
   writers lock read-modify-write and recheck source before publishing. Refutations
   cannot be acknowledged. Recipient/assigner identity, column audiences, implicit
   upsert keys and typed overloaded keys are tested. Parent ownership probes are
   excluded. Social's intentional optional photos use an ordinary source-bound
   template record; existing authored schemas never receive that stock decision.
4. Histories (39a2d8f96d): full test adds a shared 2048-attempt directed frontier, depth 8,
   four next worlds, two distinct priority successor states and two role classes
   per tuple. Current references and full engine/asset state survive replay.
   Generated initialization roots have explicit generated-fixture provenance.
   All argument, actor, state/signature, depth, population and budget cuts remain
   uncovered. 026 pickup-after-closing and 030 approval-after-suspension now replay.
   The measured matrix retains at most 12 worlds; the regression asserts <=16.
5. Role-wide writes (39a2d8f96d,124dc80f2e,88f2c3e2fa): lint/restates/draft ask whether any role member may write
   any table row. A packed executable wall-owner recipe models the relationship
   for this particular wall and refuses another wall's owner.
6. Measurement: final source census covers 400 projects/800 own/no-invariant
   checks (100 in wave 15,50 each in 16,18,19,20,21,22). No non-review compiler or
   reachable-invariant refusals. Review gates affect 67 projects: 11,9,8,8,11,15,5
   respectively. Optional-upload 57; retained-role 14; four overlap. All 115 gating
   notes clear through individual mechanical disposition probes, with zero reds
   afterward. Those probes do not assert the workflows meet their specifications.
   Wave 22: retained-role 021; optional-upload 003/018/027/040. 027 is known intended
   optionality, hence real review cost. We do not claim zero raw review refusals
   or 100% vulnerability precision.

## Visibility and eight-lane result

Before counts reproduce the bakeoff exactly. Projects with code / default-visible:
role-wide read30/4 ->30/30; broad7/0 ->7/7; grant-outlives18/0 ->10/10 (ownership
calibration removes non-assignment questions); optional-evidence10/0 ->10/10.
Insert notes 111 -> 10; result notes 539 -> 70 per-table groups across 48 projects.
Detailed counts, exact default note lines for all 50 lanes, source hashes and
reproduction scripts are in snapback4/reports/20261022-sec7/.

There are 24 full test experiments across the 8 confirmed-high lanes. None/own
intent catches 0; one independent spec-worded invariant catches 6:004,011,021,
026,030,037. Advice reaches default check in 7/8, including 021 and 026; 037 needs
independent intent and the optimized final CLI already refutes that spec at check.
040's required child evidence is gated/questioned but its always-exists assertion
is not replay-refuted. 044's constant payment and duration mismatch are visible;
its temporal assertion is not caught and its absent fee amount cannot be asserted
directly. Witness counts are not counts of independent holes. Finite generated
fixture traces are labeled; no universal security proof or application-reachable
initialization claim is made.

## Validation

- Setup: Snapback4 and root frozen Bun installs; root hoist/generated-artifact
  prerequisites; wasm and client build passed. An initial root generator timeout
  under contention left an owned dead lock; it was diagnosed, removed and the
  complete retry passed.
- Rust affected: final SEC7 17/17; SEC6 12/12; public CLI review tests 2/2 including
  concurrent writers and stock-source invalidation. Complete CLI unit 515 passed,
  check 105/105, check_notes 15/15, day 3 20/20, and untouched-starter regression pass.
- Full workspace cargo test completed: 452 targets, 7,324 passed, 6 failed,
  47 ignored; exit 101. All six failures in five targets were repaired: guide
  definition/recovery pins and app-owned review-file custody; actual retained-role
  fixture calibration; compact code-class assertions; and the wall recipe's
  block count/census shift. The full five affected targets then passed 277/277
  (88 readauth +127 guide +46 security +3 SEC5 output +13 rule recipes).
  This is a completed full run plus affected repairs, not a claimed clean full
  rerun. It covers all seven workspace crates (the requested five included).
  Its SEC7 snapshot passed 16/16; the final typed-index delta passed 17/17 and
  final corpus/packed qualification. An initial 90-minute bounded attempt expired
  in the existing large residency fixture; the completed run used DEV_OPT_LEVEL=1
  with the required no-incremental/no-debug flags and passed that fixture.
- Full client pool: 425 ordinary/timed files plus 2 full default model files ran.
  Initial 10-file reds were corrected or had prerequisites supplied (event-slot
  producer and horizon fixture helper blocked by Cargo). All 10 affected files
  were rerun; the one remaining changed social receipt fixture was explicitly
  reviewed and its full 17-test file passed. All 427 files have passing evidence;
  model files 81/81, full 5000/3000 sequence defaults. Final class-shortlist
  assertions and installed why checks passed 3/3 against freshly packed artifacts;
  the complete packed wall-recipe file passed 26/26. Initial failures are retained
  as failures, not rewritten into a publication suite receipt.
- Differential engine: 20k cases, 1,222,111 executions, 0 disagreements/new signatures.
  Device seeds 0–999: 27,922 executions, 0 disagreements. Lean: fresh model build,
  20k cases, 56,917 executions; exit 1 on 130 disagreements in exactly 4 already
  CLASSIFIED C2/W4 signatures, 0 NEW. Lean is not described as all-green.
- Wasm: 734,907 gzip bytes /735,407 budget, passed; wasm inputs did not change.
- Root guide 22/22, 0 failed/skipped/preconditions; inventories 365 package tests,
  35 script tests,31 demos,487 publication leaves; docs budget README 319/320 and
  named guide test pass. Latest ref-check 564 LLP docs,12,297 refs,0 errors/unchecked.
- Packed Linux: full consumer-only qualification passed at ba9fc4c735, including
  both clean Linux userspaces, all 6 toolchain starters, 12 frontend proofs, packed
  security 7 starters and exact rule recipes. A first attempt failed on missing
  shared npm-cache content; private-cache full retry passed. The final semantic
  source a8fb2ddf9c also passed the complete consumer-only qualification. Following
  the guide-selection/census correction at 124dc80f2e, the musl binary was rebuilt
  and fresh client/platform packs passed the security proof and installed why
  checks; the packed wall recipe also passed. Artifact hashes and source boundaries
  are retained separately. --consumer-only avoids the expressly forbidden
  scripts/test.sh; Rust/client batteries run independently. No publication receipt
  or promotion claim is made.

## Deferral and cleanup

Mac Studio only, ~/sb4-ws-sec7: an early intermediate-source CLI test passed; its
obsolete early history failure was fixed on Linux. Final-source Mac qualification
is blocked by repeated SSH connect timeouts, including the final reachability
probe. It is not claimed passed. The black publication Mac and other worktrees
were not touched; no user credentials were printed.

New tests use scoped scratch owners and experiments clean copied inputs
with TemporaryDirectory. Final cleanup removed owned temporary fixtures, generated
client captures, differential scratch, duplicate Cargo outputs, private npm cache
and bulky qualification projects after preserving compact evidence (about 26 GiB
reclaimed). The local target tree and Lean build output were removed after all
verification ended. No source
lane was modified and no push was performed. The report/evidence commit records
validation and cleanup; it adds no product semantics.


## Wave-23 day-two addendum — final source 0d950b53ae

This section supersedes the original broad upload-gate counts and review costs
above. origin/main was merged first at 01bae70281. Package versions remain
0.4.37; user-visible changes are recorded in guide changes for 0.4.38. DX6 owns
clock/session/upgrade and frontend/proof-kit weight; SEC7 changes no such behavior.

### Requested changes and commits

1. Optional-upload precision, including 003: 63089244bc, dd2db9a14b,
   dd1381d5af, 5a574708ac and c846640532. Optional media and deliberate v2
   loosening do not gate by syntax or evidence-like names. A gate needs direct
   nullable-media flow with explicit non-null intent, or independent parent-child
   presence intent plus a nullable-upload branch that skips its child. The parent
   must be a known direct, argument-independent insertion; unknown helper/control
   prefixes stay independent integrity/test coverage. Required media/assertions
   already enforce executed writes. Child-local requirements cannot protect an
   already-created parent; a guard enclosing both creations can. All twelve
   loosen lanes pass with own/no intent, including 003. The social starter ships
   no stock acknowledgment and still checks after edits.
2. 030 stale creation: 63089244bc, 19fbd8f0d5, dd2db9a14b, dd1381d5af and
   5a574708ac. **28 notes become one**, naming submitApplication,
   approveApplication and mutable operatorFlags.suspended. Group by created
   table/dependency; exclude immutable ownership and unrelated decisions. Suppress
   only complete rechecks of the same entity using compiler-selected indexes,
   source maps and immutable captures. Unknown/multiple parent identities keep the
   question. Different inspectors, partial rechecks and non-ID selectors cannot
   silence it.
3. New questions: 63089244bc through 7fcad927a8. 042 gets a specific,
   leading N_PRIVATE_CREATE_EDIT_ASYMMETRY naming agencyBillingNotes and its
   owner-only change guard; ordinary create/edit asymmetry has its own class.
   Recover only the exact supported column-change fragment; effects, alias joins,
   loops, mutable keys and multiple writes fall back to ordinary inventory.
   028 gets a grouped N_EVIDENCE_REMOVAL for removeVehicle deleting the linked
   photo. Delete/detach of an independently required child is also questioned
   with nullable media, while nullable-cell clearing alone stays quiet. All are
   advisory. Unconditional replacements remain quiet.
4. Review identity and regressions: 5a574708ac, 7fcad927a8, c846640532 and
   0d950b53ae. Module, operation, argument, table, column and source site keep
   independent review obligations. One acknowledgment cannot clear the other
   site. Analyzer sec7-10 invalidates earlier revisions. Three historical corpus
   schemas exposed a generated-table advice panic; the catalog guard and frozen
   regressions repair it. The non-null argument frontier preserves nullable
   reference/principal setup histories; the complete SEC6 target passes again.
   The guide action quotation was updated to match its already-reviewed repair.

The amendment is LLP 3000.036.004 §16.9. Final fresh Codex and Muse reviews both
returned READY. All 22 actual design/implementation review outputs, including
negative rounds and the final Muse plan-quota/Meta fallback, are saved verbatim
with hashes in llp/reviews/3000.036.004-sec7-day2-review-record.md. No key material was inspected or printed by the agent. Conservative cuts are documented coverage boundaries, not safety
proofs or lane-specific exemptions.

### Final measurement

The final binary checks 450 copied projects / 900 own/no-invariant variants:
100 wave15, then50 each in16,18,19,20,21,22,23. No source lane was changed.
There are **zero upload gates**, no panics and no compiler/non-review check
refusals. Retained-role review gates fail15 projects, by wave:0,3,2,2,3,3,1,1.
They contain36 individual notes; mechanical per-note disposition probes clear all
36, leaving zero pending/failing checks. These probes are not judgments that
retained authority meets the specification. Raw review refusals are reported,
not relabeled as zero refusals. JSON plus human check together take at most
3.396s (p95 3.231s), within the existing five-second authoring target.

Wave23 raw gating falls from10/50 to1/50 (021 retained-role only). The six falsely
gated loosen lanes and 003 no longer fail. 030's one grouped note, 028's removal
question and 042's private create/edit question all reach default check. Exact
before/after default output for all50 lanes and source hashes are retained in
snapback4/reports/20261022-sec7-day2/.

The original eight-lane matrix was rerun:24 experiments, none/own intent refute0;
spec-worded intent refutes004,011,021,026,030,037. Important correction to the
original report: 011's existing spec fixture refutes a read-privacy rule; it does
not prove the missing wall-owner relationship was caught. Do not count it as that
finding-specific catch. 040 and044 remain unrefuted by their tested intent;
044's constant-payment/duration questions remain visible. Finite history and
unmodeled-money limitations are retained rather than called safe.

The day-two matrix adds15 experiments on003,028,039,041,042. None/own intent
refutes0; independent spec intent refutes003,028,042 with2,86,12 reachable
witnesses respectively. Counts are witnesses, not separate holes. 042 includes
an actually admitted non-null billing-note history. 039's once-quoted-history
intent and041's count boundary remain uncovered by these campaigns. Those gaps
are not repaired or claimed caught by the new advice classes. Directed campaigns
retain at most12 worlds here, within the existing <=16 test bound and2048 directed
mutation-attempt cap.

### Requalification

- Full seven-crate cargo workspace and full language suite completed; both began
  before the final review repairs. Each had
  the same sole SEC6 nullable-relationship frontier failure; it was repaired and
  the whole12-test target passed. These are completed full runs plus affected
  repairs, not claimed clean full reruns. Final day-two37/37, legacy SEC7 17/17,
  CLI515 passed/5 ignored plus4/4 public tests, and guide127/127 pass. A late
  stale guide-action pin initially failed126/127 and its corrected full rerun
  passed127/127. Earlier rejected binding/gating candidates remain in review
  and validation evidence.
- Full client pool at63089244bc:425/425 files pass,7773 tests pass/56 skip; both full default
  model files pass81/81 using5000/3000 sequences. The affected packed-security
  and social-starter20 tests passed during refinement; subsequent Native-only
  advice changes are covered by the final affected tests and packed qualification.
  Final installed-test verification is recorded below.
- Difftest run20k:1,222,111 executions,0 disagreements/new signatures. Devices
  0–999:27,922 executions,0 disagreements. Lean model build passes; run20k has
  56,917 executions and exit1 on130 disagreements in exactly four previously
  CLASSIFIED signatures,0 NEW. It is not an all-green Lean claim.
- Wasm735,093 gzip bytes /735,407 budget passes after the main merge; subsequent
  SEC7 changes do not affect wasm inputs. Root frozen install, hoist, generated
  artifacts, inventories and guide22/22 pass. Final docs budget319/320 and its
  named guide test pass. Ref-check564 LLPs/12,330 refs,0 errors/unchecked before
  final evidence curation. An early docs-budget invocation omitted the flags for
  its nested Cargo call; it was rerun with all required flags and its redundant
  build output is removed during cleanup.
- Fresh packed Linux consumer-only qualification passes at0d950b53ae, including
  both clean Linux userspaces, six starter toolchains, twelve generated frontend
  proofs, packed security, migrations, staging and rule recipes. --consumer-only
  avoids the prohibited scripts/test.sh; the full Rust/client batteries ran
  separately. No publication receipt or promotion claim is made. A prior run
  correctly rejected concurrent source repairs; an early retry was stopped before
  consumer work for another review repair. Only the final frozen-source pass is
  counted. The final installed security/starter files pass20/20 against that same musl
  binary (sha25696c0c3c8538db2d20479f43e9323bff4a53eaaad321ed62c63b8b16a7cf5f433).
- Final Mac Studio SSH retry to the permitted worktree still times out. No final
  Mac pass is claimed, and the black publication Mac was not used.

### Decisions, limits and cleanup

No app-specific runtime authorization, natural-language specification parser,
new intent syntax, package version bump or publication receipt is introduced.
Independent intent remains necessary for finding requirements absent from the
schema. This work improves detection and review precision; it does not certify
zero security holes across the apps. The remaining finite-search/unmodeled-intent
limits above are explicit deferrals.

Cleanup completed after all verification ended: removed the owned Snapback4
Target tree (including duplicate Rust builds, musl output, packs, proof projects
and the private npm cache) and Lean build output. No active process used those
outputs before deletion. All six SEC7 experiment scratch prefixes have zero
remaining directories under /tmp. Compact compressed evidence and artifact
hashes are retained. Whitespace checks pass for code/report/evidence metadata;
raw review transcripts retain their original whitespace as explicitly required.
Source lanes and other worktrees were untouched. No push
was performed.
