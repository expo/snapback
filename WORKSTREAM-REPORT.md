# SEC11 workstream report

Worktree: `/home/ccheever/projects/sb4-b31-sec11`, branch `sb4-b31-sec11`. Base:
`f032742ac8`, Snapback 4 0.4.43. No version bump or push.

SEC11b continues item-1 commit `1f9b2610d3`. Items 2–4 are implemented and
measured in order, with both independent reviews per mechanism. The complete
800-schema survey has zero assessed false gates/refusals and default medians of
3 check / 5 deploy lines. Wave-30 visibility is 11/14; structurally zero medium
holes is not claimed. The final 14-step SEC11 affected plan passes on `8e06b286ce`, including 193
language integration targets and all six selected client files. Details follow
the original item-1 record below. No push or version bump.

The original item1 boundary did not claim structurally zero medium holes and
left items2–9 outstanding. Its following sections retain that historical record.
Witnessed questions remain advisory: a concrete replay establishes admitted
behavior, and cannot establish the builder's product intent.

## Item 1: witnessed decisions

Implemented current-witness refusal messages and additional bounded advisory replays for
omitted/empty media, text evidence, child-presence transitions, unchanged direct guards
used twice, and compiler-typed broad-read payloads. Answers retain SEC10's current
witness digest, exact `permit OP as CALLER` clause and audience/effect rationale. A
rejected batch publishes no decisions.

Read witnesses include the actual redacted delivered payload, distinct from the policy
row, effective logical time and visible identities. Changed delivered fields renew the
decision. Raw query results remain live-only, excluded from serialization and Debug.
Search deduplication still uses mutation prefixes.

The implementation deliberately leaves unsupported shapes uncovered: indirect or
compound guards, complex histories/assets/jobs, assignment-specific role questions, and
child-presence operations where another write or opaque effect could repair an
intermediate observation. These are coverage gaps, not gates.

Commits:

- `063c847045`: witness classes and decision refusal detail.
- `88a173a7c2`: exact guard identity, actual transitions and null redaction.
- `6525082163`: copied-schema/scoped verification runners.
- `d959a35bc1`: preserve mutation-prefix search deduplication.
- `f3612f3dbd`: actual delivered payload identity and live-only redaction.
- `267c579701`: atomic-call, cascade and commit-end expiry safeguards.
- `d9734feab5`: merge origin/main (experiment records only).
- `0dffd02350`: narrow the verification targets and retain exclusions.
- `58f30f47f0`: measurement tooling and qualified fix-forward evidence.
- `0dd5622566`: migrate existing assertions to terminal query histories.
- `648e50d083`: final measured report/evidence and item 1 archive.
- `9f52263599`: merge latest origin/main tests and experiment records.

Design: LLP 3000.036.004.001. Independent Muse and fresh Codex reviews are retained
verbatim under `llp/reviews/`; earlier findings and corrections remain visible. The
0.4.44 Guide changes entry documents this surface without bumping 0.4.43.

## Original item1 deferrals (items2–4 continued under SEC11b)

2. Approval-act inference: deferred; no new structural approval inference.
3. Assignment scoping: deferred; role-specific questions deliberately do not
   borrow unrelated broad-read witnesses.
4. Declared transitions/sibling prerequisites: deferred.
5. Entitlement consumption: deferred; item 1's bounded guard-reuse question is
   not an entitlement enforcement contract.
6. Caller-asserted history/latest subject: deferred.
7. Evidence typing gates: deferred; optional/text/child questions remain advisory.
8. Duplicable-row keyed exists/age intent: deferred.
9. Latency optimization: deferred; measured final production latency recorded
   below without claiming the targets passed.

## Verification and measurements

All 41 calibrated medium findings were matched individually by operation, material
predicate/column and relevant actual row values, using copies whose schema hashes match
Integration 27. The final 800-schema survey reports zero assessed false gates and zero
false production refusals, with no unclassified result. All fresh production verdicts
match Integration 27 (19 refusals); all post-test verdicts match SEC10's retained post-
test evidence (26 refusals). These are carried source-reviewed security findings, not
false refusals. `test` exits are 769 success and 31 exit-1 results; no watchdog/tool
exits occurred. This is not a claim that all app security tests pass despite the
commissioned holes.

Default output across 800 schemas: check median 3 / p90 7 / max 14 lines; deploy median
5 / p90 9 / max 20. Median targets pass. Wave30 check is 2 / 6 / 8 and deploy 5 / 9 /
11. The global check p90 rises from Integration27's 6 to 7; existing p90 output work
remains open. Cold production-profile timing on 50 wave30 schemas, one worker with an
independent fresh copy per call: review median **13.63 s**, p90 **25.14 s**, max 52.85
s; deploy median **18.27 s**, p90 **32.83 s**, max 70.48 s. Both the <10 s review and
<15 s deploy p90 targets are missed. No timing tool failed; peak one-minute host load
was 0.202 per available CPU. Every cold source hash and verdict matches its
corresponding completed survey result. No comparison claims an isolated machine or equal
load to SEC10's earlier measurement. Item 9 optimization remains deferred.

| Wave | M findings | Before gate / default question | After gate / default question | After advisory / nothing | Already type-prevented (subset of nothing) |
| --- | ---: | ---: | ---: | ---: | ---: |
| 26 | 15 | 6 / 0 | 6 / 2 | 6 / 1 | 1 |
| 28 | 12 | 2 / 2 | 2 / 4 | 0 / 6 | 1 |
| 30 | 14 | 1 / 0 | 1 / 3 | 4 / 6 | 0 |

The seven newly visible M questions are wave26 024 F1 and 033 F2; wave28 023 F1 and 047
F1; and wave30 002 F1, 030 F1 and 033 F2. No new production gate codes were added. The
two inherited text-type preventions receive no SEC11 credit; their requested finding
category is `nothing` (no current finding/witness), with an explicit prevention flag
explaining the existing rejection. The wave30 14/14 target remains unmet. Codex holes
004 F1 (assignment) and 038 F1 (duplicable guards) remain with deferred items 3 and 8.

Every wave30 gate was classified by hand: only 033 F1, `advanceJob` with the exact job's
`dampSigned=true` and `dampApproved=false`. Source inspection confirms that this
admitted advance reads only status; owner approval and recorded consent are separate.
Its one-line fix passes the app's acceptance.

Final security CLI unit target: 53 passed, including all 17 witness regression cases.
All 32 selected CLI integration tests pass. The full language run completed 195 targets:
2,847 passed, 3 stale history-format assertions failed, 16 ignored. Commit `0dd5622566`
updates those assertions to require the actual terminal query's caller, arguments,
clock, observed state and live payload. Each of the three exact tests then passes from
an immutable rebuilt executable, for 2,850 resolved language tests. No production source
changed. All six selected client files pass (17 tests), as do wasm/client builds,
Snapback4 docs-budget, packaged-doc lint, diagnostics and reference validation.

The original scoped receipt remains FAIL, unchanged at `58f30f47f0`, with the three old
assertions and legacy root checks recorded. The separate final scoped retry at
`0dd5622566` is PASS. Their explicit composition is recorded in `qualification.json`; it
does not claim the original canonical full pool passed. Root Snapback1 codegen failed
for missing `acorn`; its root guide reported missing JS dependencies and was cancelled,
as was the legacy root inventory check. These are outside the Snapback4 fence; no
Snapback1 bootstrap was run. Snapback4's language guide tests, two guide client files
and packaged docs were checked. No new integration-test file, metadata-declared demo or
publication leaf was added. Superseded or interrupted runs are not PASS.

Setup completed: frozen Bun install, native build, wasm build and package build. Wasm
remains 738,613 gzip bytes within its 739,113-byte budget.

Difftest: 2,000-case `run` passed with zero disagreements. 2,000-case `run-lean`
returned 18 disagreements, exactly the Integration 27 signature counts: continuation-
next 5, next 8, and E_RULE/NOT_FOUND prelude 5. This is an inherited red, not a clean
Lean pass. No interpreter/planner/store semantics changed. These differential runs were
recorded at `88a173a7c2`; the subsequent witness/report changes leave the interpreter,
planner and store oracle inputs unchanged.

The canonical affected plan expands these security/docs edits to six Rust crates and 439
client files. That conflicts with the explicit brief prohibition on full Rust/client
pools. The retained runner records the original plan, the scoped plan and omitted steps;
only the changed CLI/language crates plus six affected security/guide client files and
relevant Snapback4 docs checks are run. Final CLI targets are `verbs::security*` unit
modules and dx11, dx11_refusals, dx13, security_reviews and security_wave19 integration
targets. The earlier broad CLI attempt reached unrelated 6,929-row residency
calibration; it was interrupted and is not a full-crate PASS. `0dffd02350` records this
scope. This is not a claim that the original canonical plan completed. See
`issues/20261026-snapback4-sec11-affected-selector-expands-for-docs.md`.

## Fix-forward

On a source-only copy of wave30 lane 033, adding `require not j.dampSigned or
j.dampApproved else DAMP_APPROVAL_REQUIRED` in `advanceJob` clears the existing gate;
the app's own acceptance script passes. The raw acceptance log stays private outside the
repository. Final production-binary reconfirmation also passes; the measured binary SHA
is `9d432a5fed665c418cbed5aa26995811411ee46c10f09f9e5181139ce7924a95`.

The remaining wave30 hole lanes have no completed fix-forward acceptance claim. They
depend on deferred mechanisms above; do not infer completion from an unrelated advisory
or gate in the same lane.

## Presentation limitation

The optional-list default card currently names the admitted operation and caller but
omits the focal list value (`absent -> {}`). Full JSON and failed acknowledgments retain
the exact row and predicate. The shared compact field selector is DX14's scope; the
concrete reproduction and suggested correction are recorded in
`issues/20261027-snapback4-sec11-optional-evidence-witness-fields.md`. Counts of default
witnessed questions mean the default names the question and its admitted-call replay,
with full concrete fields retained in JSON; they do not claim every witness field is
printed inline.

Scalar-only query payloads do not satisfy the current structured read-witness check;
object/array payloads are supported. This remains an explicit coverage gap.

## Delivery and reproducibility

The final evidence bundle is `snapback4/reports/sec11-item1/`: the compressed 800 actual
results; exact per-hole coverage; gate/FIX classifications; all 50-schema cold timings
and verdict/source comparisons; the original and retry receipts; test counts; and the
lane033 fix-forward patch. The production binary and private acceptance logs remain
under `~/sb4-loop/reports/sec11/`. `provenance.json` binds the binary, build flags and
product source. The final report/evidence-only commit does not change executable inputs.

`origin/main` was merged again at `9f52263599` (main `c9b940ff2e`).
Incoming changes are experiment records and packed-proof tests/helpers; the
CLI/language/core runtime source has no diff from qualified `267c579701`.
The changed proof-contract client file passes 21 tests, all four incoming
publication helper scripts pass syntax checks, and final ref-check reports
572 documents / 12,120 references, zero errors or unchecked references.
No semantic conflict was authored; existing runtime qualification was reused. No
version bump or push. Mac, complete five-crate/client pools, device/20k campaigns and
publication qualification were outside this brief's scope.

This is a committed, measured item 1 boundary. The wave30 14/14 target, the two latency
targets, items 2–9's implementation, and the remaining hole-lane fix-forward acceptance
matrix remain outstanding. No new gate is half-wired.


## SEC11b

Items 2–4 are implemented and measured in sequence. Final affected verification
is recorded below. Latency is owned by SEC11L; no deploy files or pipeline
scheduling changes are made here.

Item 2 source is committed as `c4935cc124`; independent Muse and fresh Codex
round-3 reviews are READY and retained at `c44d763734`. Receipt/effect data
identifies the governed act; exact advisory replays cover quarantine completion,
caller-ordinal applicability bypass and an approval selected by an older subject.
The gate and advisory work bounds remain 3,072 and 8,192. All 53 focused CLI
unit tests and 32 selected security integration tests pass. The full language
run resolved 2,854 cases and had one failure from missing new-code guide test
pins (16 ignored); `85034827d8` adds those test-only pins and the exact guide
regression passes. The original full-run receipt remains FAIL, with the
resolution recorded separately. No production source changed for that repair.

Production binary `c56d97f508b15d6dbb1a7e6d5631f2678103ef563d6501e6dba0fde045469c73`
is source-hash bound. On wave30 source copies, the 018 quarantine guard, 025
count/latest guards and existing 033 damp guard clear the targeted current
witnesses. 018 and 033 unchanged acceptances pass (033: 66 checks). The 025
acceptance reuses a candidate with attempt=1 in two independent scenarios; the
untouched script therefore fails after a correct counter repair. Isolating
those scenarios with fresh candidates retains every original assertion and
passes all 16 checks. Original failures, the fixture-only isolation patch and
source hashes are retained; no unchanged-025-acceptance PASS is claimed.

Item 2 measured boundary (2026-10-27):

| Corpus | Before visible | After visible | After gates / questions |
| --- | ---: | ---: | ---: |
| wave26 | 8/15 | 8/15 | 6 / 2 |
| wave28 | 6/12 | 6/12 | 2 / 4 |
| wave30 | 4/14 | 7/14 | 1 / 6 |
| wave31 | 3/16 | 6/16 | 1 / 5 |

Exact operation matching corrects the earlier broad helper's 018/025 names:
only `pruneTouchup` and `logExam` supply the newly credited approval witnesses.
All 800 fresh and 800 post-test JSON deployment verdicts completed normally:
19 and 26 carried refusals, zero assessed false gates or false production
refusals, zero unmatched gate/FIX/refusal records. The sole wave30 gate is hand
reviewed: `advanceJob`, booked -> grinding, dampSigned=true/dampApproved=false.
The approval gate renderer names the executed `advanceJob` operation. The raw
static source hypothesis still names acceptQuote, while its actual candidate,
compact summary and last history step name advanceJob; no acceptQuote coverage
credit is claimed.

Default check median/p90 is 3/7 lines; deploy is 5/9. All 800 default check
and 800 default deploy outputs now complete after same-binary phase retries.
The earlier two censored display attempts and their median bounds remain in
the committed measurement history. The original classifier listed two watchdog
gaps: wave25 lane040's private HTTP preparation watchdog (also reproduced with
two survey workers), and wave27 lane035's external test watchdog. SEC11b's
final accounting also includes22 non-timeout private preparation exits:24 test
qualification gaps in total. Pending security findings can block the private
deployment before HTTP admission; a preparation exit is not automatically an
infrastructure or latency fault. Original records and the accounting correction
are retained, never relabeled PASS. Deployment after the
recorded test command is measured; complete HTTP test qualification is not
claimed. This is a disclosed infrastructure gap under LLP 0232; follow-up is
`issues/20261027-snapback4-security-http-preparation-watchdog-under-survey-load.md`.
Latency work remains SEC11L's. Original 800 results and every same-source/binary
retry are retained, including an interrupted redundant single-worker retry.
No failed or interrupted campaign is relabeled PASS. The measurement tooling
separates classified infrastructure from security verdicts: unmatched gate/FIX,
source mismatches, unknown deployment exits and runtime panics stay unclassified.

The evidence bundle is `snapback4/reports/sec11b/item2/`, including source
hashes, compressed original/composed/retry records, per-hole coverage,
precision classifications, the hand-reviewed gate and fix-forward patches.

The 2,000-case standard differential run has zero disagreements. The 2,000-case
Lean run reproduces the same 18 inherited disagreements and signature counts as
item 1; this is not a clean Lean PASS. Root reference validation passes with
573 documents / 12,122 references, zero errors.

Item 2 is implemented and measured at this boundary. Items 3 and 4 follow in order.
No push or version bump.

### Item 3 — assignment scoping, implemented and measured

Source commits: `4a17c2109e` (questions), `132d06a032` (one-query facts),
`a7f7256397` (complete hypothesis identity), `9d36412758` (ID-only regression).
Final mechanism reviews: Muse round3 and fresh Codex round2 READY. The initial
Codex findings are fixed, with all responses retained verbatim. Presentation
commits `c50f8dbc5b` and `3c3f9ffb14` keep each assignment card factual and
compact, replacing only positive deployment feature counts when needed. Both
final presentation reviewers are READY (`820f096c14`). No deploy files or
pipeline scheduling changed.

Coverage, against item2: wave26 **8/15** (6 gates,2 questions), wave28 **6/12**
(2 gates,4 questions), wave30 **9/14** (1 gate,8 questions), wave31 **8/16**
(1 gate,7 questions). The two additions are precisely004 F1 and014 F1; the
matcher requires the actual coordinator/lead role, operation and payload.
004 shows coordinator1 reading careNeeds assigned to coordinator0;014 shows
lead0 receiving clientPhone without inventing an assignee or creator.

All800 source hashes match. Fresh and post-recorded-test deploy measurements
have **zero assessed false gates/refusals and zero unclassified verdicts**,
with19/26 carried refusals. The sole wave30 gate remains033 advanceJob; its
actual booked→grinding write has dampSigned=true,dampApproved=false and is
hand-reviewed.40 test qualifications are incomplete:26 preparation watchdogs
listed in precision.json and the open watchdog issue, plus14 non-timeout private
preparation exits listed in http-gap-accounting-correction.json. These are never
PASS; non-timeout exits are not assigned an infrastructure root cause from the
retained summary alone. Deployment
after the recorded test command is measured; complete HTTP coverage is not
claimed. An unused shorter-timeout035 replay is outside the selected800; its
timeout does not replace the selected original's completed full test.

The policy survey uses frozen production binary
`f90a285713ce229d3de35a230b474401167cdab518fff74797c16f5307ca82f3`.
Its original two-line cards measured4/7 median lines, retained as the before
formatting result. Only two production source inputs subsequently change:
new-tier rendering and placement of positive feature counts; policy, campaign,
witness content and identity are unchanged. The final production formatter
replays exact native blocks over **all800 records**: **check median3 /p907 /
max14; deploy median5 /p909 /max20**, zero censored displays. Fresh native
preflights004,014 and wave28's037 confirm current output and byte-identical
decisions/witnesses on executable
`852edc845bc7480b8e3508dfebcd1b5c5d32b92c07e216f3be9f152dadddca5e`.
Both qualification snapshots and the unchanged-source proof are explicit.

Fix-forward: both targeted assignment questions clear.014's unchanged app
acceptance passes.004's original acceptance explicitly expects both staff to
read jobA; the repaired copy checks the same positive payload on each staff
member's own job and adds both foreign-job refusals. **182 assertions pass**;
this is a corrected broad-access expectation, not unchanged004 acceptance.

Tests: original CLI units **55 PASS**, five selected integration targets
**32 PASS**. Full language:195 targets,2857 passes,1 failed clock deadline,
16 ignored; exact unchanged isolated retry **PASS1.29s**, original failure
retained. The presentation unit rerun has55 passes and1 file-not-found failure
while a concurrent rebuild replaced the executable read for evidence
fingerprinting; exact isolated retry **PASS304.24s**, no source change. Final
format tests **2 PASS**, including the complete800-record production replay.
Packaged docs, Snapback4 diagnostics and reference checks passed. The legacy
root inventory attempt timed out at300s; it is not PASS and does not expand
the Snapback4 fence. The final affected receipt follows item4.

Measurement composition:600 local cases,50 wave24 and50 wave27 fleet cases,
and100 wave25/29 cases selected before replay from fixed snapshots plus45
missing local cases. Every case is selected once with binary/source/record
digests; no partial parent is called complete. All extra fleet attempts and
interruption receipts are retained outside git; zero recorded owned processes
remain, and only owned temporary folders were removed. The original123-case
interrupted run remains retained. No other worktree was accessed.

Evidence: `snapback4/reports/sec11b/item3/`, LLP3000.036.004.003 and its verbatim
reviews. Item3 is implemented and measured at this boundary. Item4 follows.

### Item 4 — declared transitions and sibling prerequisites, implemented and measured

Added exact advisory questions for 030 `publishReport` measured→reported and
035 `advanceStage` inspection→finished. Full applicability and typed
write/guard/argument descriptors bind the hypothesis; names and enum order
confer no authority. Anchors retain original authored fields/targets before
helper reduction. The admitted edge must survive commit. No-op, reverted,
deleted and expired effects cannot commission a card. No new gate family or
larger campaign budget, and no deploy files or scheduling edits.

Review regressions exposed legacy workflow precision gaps: unreduced spreads
can overwrite a state or hide a reopening edge. These shapes remain uncovered;
unmapped/source-unrestricted parent state writes cannot establish terminality.
Ordinary inference still passes its baseline. Implementation starts at
`ca8aebea2a`, with final source and scope corrections through `883aeea5d0`.
Both fresh round-8 reviews are READY, retained verbatim under `llp/reviews/`.
Key source refinements and every earlier finding are recorded in
`reports/sec11b/item4/review-resolution.md`. Main merged at `f8fa80dc50`
(origin `98177aa48b`, benchmark records only); the final fetch found no newer
main. All 1,961 frozen production inputs remain byte-identical.

Frozen native SHA-256:
`3a4ac751164bb96b7a07c8076e65b89350b2916c1d50704e73dc99815212d6b7`.
All 800 source hashes match. All fresh and post-recorded-test deployment
commands completed: 19/26 carried refusals, zero assessed false gates or false
production refusals, and no unclassified findings. All 800 default check and
800 default deploy outputs are uncensored: check median/p90/max 3/7/14 lines;
deploy 5/9/20. Seventeen private HTTP preparation exits remain incomplete
qualification, never PASS. The selected run has no preparation or external
watchdogs. Diagnostic 033 and wave-26/008 replays show private deployment
blocked by existing pending security findings; other root causes are not
inferred from summaries. Deployment after a test command does not establish
complete HTTP admission. Of 800 test commands, 769 exit 0 and 31 exit 1.

| Corpus | After item 3 | After item 4 | Gates / witnessed questions |
| --- | ---: | ---: | ---: |
| wave 26 | 8/15 | 8/15 | 6 / 2 |
| wave 28 | 6/12 | 6/12 | 2 / 4 |
| wave 30 | 9/14 | 11/14 | 1 / 10 |
| wave 31 | 8/16 | 10/16 | 1 / 9 |

The seven-schema preflight verifies eight exact effects, retaining
004/014/018/025/033 and adding 030/035. The sole wave-30 gate is still the
hand-reviewed 033 `advanceJob` approval bypass. The three remaining wave-30
misses are 006 F1, 010 F1 and 038 F1, belonging to later work. Items 5–8 are
not implemented by this lane; item 9 is SEC11L.

The native survey selects 600 local cases plus 200 on GMK. Shared-host A/B
attempts were slow; their two complete 100-schema populations were assigned
to local replicas before those replica verdicts. The unused 14/8 completed
records and all interruption receipts remain archived outside git; they are
never PASS or selected results. Only owned temporary roots were removed,
with zero recorded owned fleet processes remaining. All selected cases are
source/binary matched and selected exactly once. Concurrent timings are not
isolated latency qualification. Both previous long cases finish their test
commands here: wave-25/040 exit 0 in 274.698s; wave-27/035 exit 0 in 954.182s.
Their earlier failed attempts remain unchanged.

All copied 030/035/018 repairs clear their targeted witnesses. The unchanged
035 acceptance passes 133 checks; 018's unchanged acceptance passes. The
untouched 030 script fails at its unreviewed late-publication expectation with
BAD_STATUS. Its adjusted script retains late-report checks, denies unreviewed
B, then reviews B before advancing the clock; PASS. Patches, source hashes
and original failures are preserved; no unchanged-030 acceptance PASS claim.

Focused tests: 10 transition tests, 3 CLI tests, 128 guide tests and the
six-case parent-reopening regression PASS. Final-source 2k standard differential
run has zero disagreements. Lean 2k retains 18 inherited disagreements in the
same three signatures, plus 324 unsupported cases; not a clean Lean PASS.
Packaged-doc lint and correctly prefixed docs-budget/self-containment checks
PASS. One earlier docs wrapper omitted the Cargo environment prefix and had
already completed before the stop inspection; its original output is retained,
and only the correctly prefixed rerun qualifies. Final affected verification
is recorded below after the measured-source commit.

Evidence: `snapback4/reports/sec11b/item4/`, LLP 3000.036.004.004, source/review
commits `b118adea22`, `332329e47c`, `aac46d4e56`, and final native-packet
commit `26669e2eb4`. Native records, per-part receipts, coverage, precision, fix-forward
patches, source hashes and qualified output counts are retained.

HTTP accounting correction (SEC11b,2026-10-27): the original parser counted
watchdogs but omitted private preparation exits with status1. Immutable item2
records contain24 incomplete test qualifications (22 exits,1 preparation
watchdog,1 external watchdog); item3 contains40 (14 exits,26 preparation
watchdogs). Original receipts remain unchanged, with correction artifacts beside
them. Source-matched gate/FIX/refusal classifications and line counts are
unchanged. The two diagnostic item4 replays demonstrate that existing pending
production security findings can block private deployment before HTTP admission.
No such incomplete campaign is a PASS or an inferred latency failure.

### Final affected verification

The initial selector preflight rejected the uncommitted report before running
any tests. Its log and original/scoped plans are retained under
`~/sb4-loop/reports/sec11b/dirty-preflight-sec11b-final-affected*`. The report
is checkpointed so the final run binds a clean committed tree. Results follow
after that run; the rejected preflight is not a test PASS or product failure.

The clean a9c7e8487b scoped attempt has a FAILED receipt, retained as
`invalid-language-sec11b-final-affected*`. Builds, 60 CLI security unit tests,
32 selected CLI integrations, diagnostics/docs/ref checks, and all six client
files (17 tests) passed. The three language invocations were malformed: the
canonical plan already supplied `--` and libtest arguments, and the scoped
wrapper appended Cargo target selectors after that separator. These attempts
are not qualifying language coverage, regardless of an empty filtered result.

The wrapper now inserts `--lib`, `--test '*'`, and `--doc` before the separator,
retaining canonical harness settings for integrations/doctests and four threads
for units. A plan-only audit checks all three actual commands and the 14-step
scoped plan. Production sources and the native800 packet are unchanged. The
complete corrected scoped plan runs on the new clean committed tree; results
follow after that run. No failed attempt is relabeled PASS.


### Parent-window correction after final-test failure

The correctly scoped attempt on 5e64614e03 found a real product regression:
`parent_window_coupling_requires_the_exact_changed_parent` failed because
completion terminality uncertainty erased an independent parent-window contract.
The partial run is retained as `parent-window-regression-sec11b-final-affected*`;
its completed builds and CLI checks pass, but language integration was interrupted
after 121 targets / 1,791 passing tests and is not complete coverage. Only the
recorded owned process tree was stopped, with identity/cleanup receipts retained.

Commit b25313ff7d keeps unmapped targets uncovered, emits the independent window
for known-target unrestricted writers, then skips terminal completion inference.
The existing ten-case coupling test and six-case reopening test pass unchanged.
Fresh Muse and Codex round-9 reviews are READY. The corrected native executable
is `2b59f9ee40869f34041eed1803ad087d97577d80e09c0616c1aaf546242112ac`.

All 857 frozen inputs (800 survey + 50 wave31 + seven repairs) have byte-identical
ordered derived obligations and diagnostics. Serialization omits executable
syntax, so this is explicitly not a general AST-equivalence proof. Unchanged
normalizers and window/completion constructors, the narrow uncertainty-guard
relocation, and byte-identical other 1,960 source inputs support this specific
reviewed bridge. Fresh native checks reproduce all eight effects on seven schemas,
including byte-identical decisions and witness IDs. Fresh 030/035/018 repair
acceptances pass; the same original 030 bypass expectation remains a failure.

The original 3a4ac751 native800 packet stays immutable. Its coverage, precision,
line counts and 17 HTTP qualification gaps carry through this reviewed narrow
correction; there is no claim of a second native800 execution. Evidence lives in
`snapback4/reports/sec11b/item4/window-correction/`. A new clean committed-source
full scoped verification follows; the failed partial attempt is never PASS.


Correction qualification is committed at 1c52585da0. Latest origin/main
750a8c34fa is merged at 7c993cad1c; incoming benchmark/publication records add
no production input changes. Corrected-source standard 2k differential run has
zero disagreements; Lean 2k retains exactly the inherited 5/8/5 signatures
(18 disagreements, 324 unsupported). The correction's evidence manifest binds
its retained records; independent preflight unit results and the final 14-step
scoped receipt are reported after completion. This report checkpoint is committed
before final verification; results may be appended uncommitted as the brief allows.


### Pre-merge result — all requested SEC11b items complete

Tested final commit: `8e06b286ce1b26e8dad87bc3d7764d46773f9106`.
All 14 steps of the scoped SEC11 affected plan PASS. The receipt reports
`complete: true`, `unchanged: true`, `ok: true`; no source or report changes
occurred during that run. The code and measurement packet are committed. This
final results-only report append is left uncommitted as the brief permits.

| Final affected check | Result |
| --- | --- |
| CLI security units | 60 passed, 0 failed |
| Selected CLI integrations | 32 passed, 0 failed, five targets |
| Language units | 155 passed, 0 failed, one ignored metrology utility |
| All language integrations | 2,714 passed, 0 failed, 16 declared ignores, 193 targets |
| Language doctests | Successful command, no doctests declared |
| Selected client tests | Six files, 17 passed, 0 failed/skipped/cancelled |
| Frozen dependency install, CLI/WASM/client builds | PASS |
| WASM gzip budget | 738,613 bytes / 739,113; unchanged limit |
| Diagnostics registry | PASS; 3,593 codes and 9,654 emitting sites |
| Docs budget/self-containment and packaged-doc lint | PASS |
| Reference check | PASS; 575 LLPs, 12,143 refs, zero errors/unchecked |

Canonical selector planning is retained, together with the explicit SEC11
scope override. This is the completed 14-step affected plan, not a claim that
the complete broad canonical battery passed. The user-prohibited full Rust and
client pools, unrelated CLI targets, device/20k differential batteries, Mac and
publication qualification are excluded as recorded in the scoped plan. Direct
2k standard differential testing has zero disagreements; 2k Lean retains the
same 18 inherited disagreements (5 continuation-next, 8 next, 5 prelude-code)
and 324 unsupported cases. Lean is not a clean PASS. Earlier malformed and
product-failed/interrupted runs remain unchanged and never qualify this result.

All 1,961 frozen production inputs still match the corrected native packet.
The correction manifest verifies. All four calibration files still match the
measurement hashes. Wave 30 is 11/14 visible with exact witnesses (one gate,
ten questions); its remaining misses are 006 F1, 010 F1, 038 F1. Wave 31 is
10/16 (one gate, nine questions); remaining misses are 002 F2, 006 F1, 010 F1,
010 F2, 014 F3, 014 F4. These are beyond the requested item-2–4 cases. No claim
of structurally zero medium holes is made. Items 5–8 remain future work; item 9
belongs to SEC11L.

The 800-schema packet has zero assessed false gates/refusals, no unclassified
findings, and check/deploy median lines 3/5. Its 17 incomplete HTTP qualifications
remain explicit gaps; historical item-2/item-3 incomplete totals are 24/40 after
the retained accounting corrections. The parent-window correction carries the
immutable original native800 packet by the narrow reviewed equivalence bridge
and fresh native witnesses; it is not a second native800 execution. Nothing here
claims isolated latency qualification or complete HTTP admission.

Latest fetched origin/main `750a8c34fa` is merged at `7c993cad1c`; no push,
publication or version bump. The 0.4.44 Guide changes entry covers all three
mechanisms. LLP children 3000.036.004.006/.003/.004 and verbatim Muse/fresh Codex
reviews preserve each mechanism's decisions and corrections.

Final evidence outside git:

- `~/sb4-loop/reports/sec11b/sec11b-final-affected.log`
- `~/sb4-loop/reports/sec11b/sec11b-final-affected.original.json`
- `~/sb4-loop/reports/sec11b/sec11b-final-affected.scoped.json`
- `~/sb4-loop/reports/sec11b/sec11b-final-affected.receipt.json`
- `~/sb4-loop/reports/sec11b/sec11b-final-summary.json`
- `~/sb4-loop/reports/sec11b/sec11b-final-tested-source.json`
- Local canonical receipt: `target/affected/8e06b286ce1b-1793112272423.json`.

Final scoped receipt SHA-256: `ff61bf583465b5528b6fe749ed4b2c1f98d641ee541717cefc401194ee2fdb8b`.
Final log SHA-256: `4e8555c50da964931bf54dcb3682d297117c9ccb039813c970e060ec5f94f85d`.


### Late main integration (pinned 2921a639cc)

After the complete PASS on 8e06b286ce, the shared remote-tracking reference had
advanced by 100 commits while verification ran. The lane pins Integration 28
snapshot 2921a639cc for one final merge; it will not chase a moving exact HEAD.
The pre-merge receipt and all original per-item measurements remain immutable.
The previous final totals apply to the pre-merge measured boundary only.

Merge resolution combines SEC11b Bound candidates with SEC11L's batched compiler,
keeps current-report joining/independent fixed-budget campaigns, preserves SEC12
release gate checks and compact evaluated-answer presentation, and retains the
assignment/transition witness predicates. Cached advisory key is renewed. A
suppressed positive feature summary still prints meaningful test status. No
new scheduling or deploy-verb optimization is introduced by this resolution.

Integration 28 assigned provisional .002 to SEC12. The unpublished approval
amendment now has fresh sibling identity 3000.036.004.006; original review
filenames and immutable packets retain their provisional-number provenance.
Assignment .003 and transition .004 retain their identities. The collision ticket
is resolved with this mapping; live code and Related links use .006.

The imported main version is 0.4.44; this lane adds no independent version bump.
All requested guide additions remain in the 0.4.44 entry. Fresh merge reviews,
focused current-native replays and post-merge affected results follow separately.
No unchanged-native800 claim is carried across these incoming product changes.
Per-item coverage/precision/output measurements remain their named snapshots.


The semantic merge has independent READY Muse and fresh Codex reviews. An earlier
Codex response disclosed accidental prior-review exposure; it is retained verbatim
but does not count. Integrated language unit preflight passes197 tests with one
ignored metrology utility. Post-collision ref-check passes578 documents/12,173refs,
zero errors/unchecked. Current product sources remain unchanged since13d50f273d.
The final affected baseline pins2921a639cc, preventing later shared-ref movement
from silently changing this run. The new integrated native corpus/fix-forward
results are retained outside git under `~/sb4-loop/reports/sec11b/`; historical
per-item packets stay committed unchanged. Final results follow after completion.
