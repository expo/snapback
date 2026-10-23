# SEC9 — structural write authority, final handoff

Branch `sb4-b25-sec9`, built on SEC8 (`3361d0e47d`). No push and no version bump.
Merged origin/main twice: `ca8ea5efd9` (901a362705), then `b0faf93332`
(46c6cdd056). The latest merge preserves both appended journal suffixes and both
code-guide additions; it did not require semantic conflict resolution. No lane
authored changes touch rollback_views, release_bridge or rollback_visibility.
DX8 owns backfill/down, process hygiene, dev clock, sql, account helper and
rename-down. Integration owns Mac and publication. User-visible guide changes
are recorded under **0.4.41 guide changes** in the client changelog.

Implementation is committed, including the final semantic revision `699e0625a4`.
The governing amendment is
`llp/3000.036.004.000-structural-write-authority.rfc.md`. Ten review rounds were
preserved verbatim with provenance under `llp/reviews/3000.036.004.000-sec9-*`.
The final semantic revision, including main integration, received **READY from
both fresh Muse spark contributor/high and Codex gpt-6.1-sol/high sessions in
round10** (`0ff3a2a964`). Muse used the prescribed fallback on plan-quota errors;
no credential was read or printed. Earlier READY verdicts are not presented as
covering later revisions. Reviews found and led to actual fixes, especially raw
schema validation, hidden-cell equality disclosure, assigned sequence values,
unknown live-reference comparisons, approval invalidation and Boolean/setup
history retention.

## Per-item implementation

### 1 / S1 — enforced column write audience

`photo: image? write <- P` is a language and validated-schema capability, shared
by insert, update, upsert and insert-if-absent. Non-null creation/defaults require
P; replacement/removal require P on both images. Completed sequence values are
rechecked independently of read admission. Raw schemas cannot place guards on
unsupported engine/maintained/system fields or bypass through generated writes.
Private guarded/frozen cell changes require readable current row and cell before
comparison; failure remains NOT_FOUND. Device guarded writes queue to the server
before target probing; full schema validation remains on every host. The earlier
device validation omission experiment (`9b4bceb09e`) was withdrawn.

The complete “only X may add, replace or remove Y” recipe, language card and
capability rows are included. Generated `$enforced/` adversarial contracts cannot
be acknowledged away. Role-enumerated tests exercise every write arm, defaults,
removal, ownership change, raw/import/system paths, live parents, hidden cells,
and sequence assignment. Main commits: `e5ea853117`, `0fcff18637`, `5af2d3d501`,
`456083755b`, `bbe8830832`. Final column suite:10/10 pass.

### 2 / S2 — create/edit asymmetry is a review gate

Recognizes table `old.c = next.c or P` and column edit guards. A wider creation
path requires either the column write rule or a matching
`invariant T.c update only P` deliberately documenting creation differences.
Creator/default/viewer substitution and safe current-image reflexivity remove
false shapes; unresolved live references retain unknown semantics. Default-only
and immutable inferred candidates do not invent creation intent. Individual
selected-schema review snapshots use the actual selected source.

Wave25 has three gated lanes015/017/045; the predicted false shape is removed.
The fixed450 corpus has17 newly gated projects/22 sites. Isolated matching
update-only declarations clear all22 with21 unique lines. This is a tested
acknowledgment path, not acceptance on the builders’ behalf. Full audit and counts
are in `snapback4/reports/20261023-sec9/CORPUS-AUDIT.md`. Main commits:
`44e804e805`, `002a911ff1`, `43f7c1619d`, `bbe8830832`.

### 3 / S3 — authority survives note ranking

Column-specific N_INSERT_WRITE_INTENT and derived authority notes rank3. The five
specified lookup/filtered/unique/sparse/maintained hygiene notes rank6.
Authorization review notes are retained in default check even when ordinary
presentation limits are reached. A structural enumeration test prevents cutting
authority notes while displaying hygiene. Commit `44e804e805`; final language
unit and CLI ranking checks pass.

### 4 / S4 — derived production campaign refuses actual FIX

Derives non-null insert probes from column-specific edit guards, approval/edit
probes for inspected payloads and alternatives for gating booleans. Candidates
bind the exact policy SHA; executable witnesses use actual paired images.
Approval/edit inference fails only if approval survives the edit, so deliberately
invalidating approval is not a false refusal. Authored immutable rules remain
strict on the preimage. Derived acknowledgments are individual and rule-bound;
they cannot waive authored or enforced contracts. Semantic schema, program and
invariant changes require a current campaign; cached passes provide no bypass.

Production runs8192-work/10s bounded replay and refuses reachable unacknowledged
FIX or pending gates. Staging stays advisory unless strict. The added security
preflight reports its own elapsed time:450-project median2782ms,p9510135ms,
max10201ms; wave25 median5337.5ms,p9510140ms,max10160ms. Timing includes analysis,
replay, source revalidation and dispositions, not the entire deploy. Slight
overshoot includes work outside the checked campaign deadline. Coverage gaps
remain visible when bounded work stops. Commits `44e804e805`, `0fcff18637`,
`9e553580bc`, `f08794525b`, `699e0625a4`.

### 5 / S5 — approval freezes evidence in the store

`immutable c when P` is proposed by N_EDIT_AFTER_APPROVAL. Store mutation and
import replacement enforce P on the preimage, including trusted system mutation;
thaw plus replace in one patch is refused. Omitted optional nulls are normalized
on both images. Parent-status and hidden-target cases are covered. Explicit
`load_trusted` persistence restoration remains a documented raw-image exception,
not a mutation API. Tests prove strict freeze and optional absence semantics.
Commits `e5ea853117`, `0fcff18637`, `456083755b`, `bbe8830832`.

### 6 / S6 — reach existing clock, cross-row and read-through intent

Concrete evaluators use actual step clocks and provisional snapshots, checked
duration arithmetic, typed live references, aggregate element scope and logical
read-through existence. Histories propose schedule boundaries and preserve
role-compatible principal tuples, explicit missing/non-null values and distinct
image replacements. Admitted Boolean projections survive initialization rounds
on fresh parents. Early setup and stricter predecessor checkpoints share the
original mutation budget; neither resets counts nor enlarges the frontier.

Clock expansion prioritizes authored clock intent or clock-dependent
Require/Check guards, including aliases; temporal payload-only/other unexpanded
histories remain explicitly uncovered. The reproduced043 scheduled, assigned,
missing-evidence transition is covered by an exact regression. Final one-line
replays produce043=17 witnesses; extra evaluator controls013=16,015=12,031=1 and
033=25. Their added intent is evaluated, rather than labelled syntactically
unsupported. Generated-fixture roots are explicit assumptions, never empty-start
proofs. Commits `5af2d3d501`, `456083755b`, `7f19df4a79`, `f08794525b`,
`699e0625a4`. Final SEC6/7/8/9 suites:50/50 pass.

### 7 / S7–S8 — presence loosening and whole-save recipe

The first successful check records an ignored local presence baseline; a later
required-to-optional change gates until focal-column presence intent or an
individual disposition exists. Failed checks cannot bless the baseline. A fresh
checkout does not invent a predecessor; production independently compares the
prior released schema. Each deliberate optional column has an explicit line.
The runnable recipe includes
`update (old, next) <- old.y != null or P`, ownership and examples proving that
only the designated role may save while evidence is missing. It also exercises
column write and immutable rules. Commits `44e804e805`, `456083755b`,
`a0e0b418ec`, `a609ce8826`, `bbe8830832`.

Every added/changed recipe is checked in the guide suite; the complete new block
is extracted verbatim from the installed fresh tarball and executed in packed
security qualification. Packed security tests3/3 pass. Guide127/127 pass;
recipe suite13/13 pass; device authoring census updated to878 entries.

## 8 — real findings and corpus remeasurement

All nine requested findings have actual reachable witnesses at the applicable
one-line specification site on the final R10 executable. A failing test here is
successful detection of the copied deliberately vulnerable app, not a test-suite
regression. These are finite campaign observations, not safety proofs.

| Finding | Structural outcome / needed intent | Final exact-site witnesses |
|---|---|---:|
| wave25 015 F3 | Creation asymmetry gates without intent; derived non-null insert is detected. Adopting column `write <- desk` makes every unauthorized write arm impossible. |6|
| wave25 043 F1 | Whole-save update intent is needed; advanced clock reaches missing authorization past schedule. Recipe enforces the intended rule once adopted. |17|
| wave25 036 F2 | One-line approval edit intent detects it; adopting `immutable sketch when approved` prevents it in the store. |1|
| wave24 011 F1 | One-line approval/gating-Boolean intent, both values explored. |11|
| wave24 029 F1 | Derived approval/edit replay catches it without intent. Correct authored boundary `invariant bookings.weight update only .tour.status = 'booked'` also catches it; conditional immutable can enforce it. |24|
| wave24 007 F2 | Presence intent gates the optional-create shape and the test refutes it. |137|
| wave24 036 F1 | Presence intent gates the optional-create shape and the test refutes it. |25|
| wave24 008 F1 | One-line cross-row/child evidence intent is evaluated and refuted. |23|
| wave24 033 F1 | One-line read-through/child evidence intent is evaluated and refuted. |25|

Final no-intent comparison reran all nine on the exact R10 executable with
all authored invariants removed, and separately with the original invariants.
Derived policies alone find015F3 (insert) and029F1 (approval/edit). The other
seven have no exact requested-finding witness without the extra specification
line. Original033 also refutes its existing read invariant; that is not counted
as the added child-evidence intent. These18 comparisons and all traces are
retained in final-evidence/no-intent.

Extra controls:013F1=16,015F1=12,031F1=1,036F2=1. The original029 repro's broad
always line does not encode the actual edit boundary and was not silently counted
as detection; the final corrected line follows the bakeoff. The unrelated
wave24 015F2 repeated-transition case remains undetected in the broader earlier
matrix and is not one of the requested nine. No global uninspected-evidence
freeze or undeclared whole-save rule is invented.

The fixed450 corpus is wave15(100),16/18/19/20/21/22/23(50 each). Final counts:
32 gated projects/58 sites:SEC8 retained-role15 projects/36 sites plus SEC9
creation/edit17 projects/22 sites. Production refuses36:32 pending-gate projects
and four further authored read-intent contradictions; other errors0. The new
creation gates all correspond to actual audience differences; matching explicit
intent clears them. No false new gates or false authored/derived FIX refusals
remain in the audited set. This does not mean36 confirmed holes. Wave25 alone:
50 projects, three gates, five production refusals (three gates plus authored
roles.read contradictions006/033). Funeral-director approval-invalidation false
refusals were fixed before these counts.

The initial500-project experiment accidentally included wave24; it remains
labelled as500 and is never passed off as450. Final corpus/deploy data uses R9;
R10 changes only unbounded test initialization checkpoints, leaving bounded
production/check inputs and execution unchanged. Final findings use R10.
Immutable executable digests, source hashes, result archives and detailed witness
logs are under `snapback4/reports/20261023-sec9/final-evidence/`; see its README
and CORPUS-AUDIT for provenance and scope.

## Validation and unresolved results

All commands were timeout-bounded; cargo commands used incremental=0/dev-debug=0/
test-debug=0. The full scripts/test.sh was not run. Linux consumer qualification
used its explicit consumer-only mode.

| Check | Result and limits |
|---|---|
| Full Rust workspace, all crates/test binaries | Ran to completion:7455 passed,30 failed,282 ignored across470 binaries. Nine SEC9 failures were repaired;21 remaining metadata/execution-facts failures match SEC8's recorded failure set, not independently re-baselined. See breakdown below. |
| Final affected Rust |258 passed,0 failed:45 language units,10 column writes,127 guide,13 observers,12 SEC6,17 SEC7,12 SEC8,9 SEC9,13 recipes. |
| Post-main core command tests |8/8 pass. |
| Post-main CLI unit batch |549 pass,1 fail,9 ignored. Ownership sidecar immediate reopen failed E_STORE_BUSY; exact isolated rerun1/1 pass. Ticket below; batch remains red. |
| Full normal client pool |428 files,7889 tests:7828 pass,5 fail,56 skip. Narration and intentional-null fixture expectations fixed; focused reruns11/11 pass. HTTP transfer and inherited residency remain red. |
| Full-count client models |89/89 pass with5000 session and3000 online cases. |
| Wrapper fixture pool |9/9 pass. |
| Final fresh packed security |3/3 pass; separate HTTP retry test still fails. Installed guide recipe and CLI interactions ran as written. |
| Difftest run |20,000 seeds from0,9 oracles:zero disagreements/new signatures. |
| Difftest devices |Seeds0–999,both memory and SQLite,8 oracles:zero disagreements/new signatures. |
| Difftest Lean |100,000 cases:761 disagreements in the same five known signatures; no new signatures. Not zero-disagreement success. |
| Wasm |2414852 raw /737825 gzip; budget738325 passes. Former ceiling735388 raised2937 bytes with same-commit rationale/JOURNAL in456083755b; full device validation retained. |
| Docs budget |README319/320 words; named budget test passes. |
| Root prerequisites |Frozen bun install,workspace hoist,generated artifacts pass; initial generated-artifacts300s timeout retried with a sufficient bound. |
| Root inventories |Pass:365 package tests,35 script tests,31 demos,487 publication leaves,162 pages,1937 snippets. |
| Root guide |22/22 checks pass. |
| ref-check |566 LLP docs,12392 references,0 errors,0 unchecked. |
| Linux fresh-pack qualification |Ran twice; incomplete at Day5 installed testing-guide residency with E_SCHEMA source-reservation mismatch. No consumer/publication receipt, no qualification claim. |
| Mac |Skipped as directed:Studio unreachable,black M5 reserved. Integration owns it. |

The21 full Rust failures are CLI residency2/timeline2, device readauth8, language
live-parent6/declarative-receipts1, simulator maintained-recorded2. They match
`issues/20261022-snapback4-source-reservation-full-suite-failures.md`. The repaired
nine were selected review/day5 preview/deploy advisory expectations, device
census, guide marker/word/code audit, observer unsupported wording, SEC7 child
reachability and recipe count. The latest258 affected pass does not turn the
entire workspace green.

Client residue:HTTP interrupted one-view retry returns410 Gone instead of200
with Content-Length8388608 (parent+nested failure count2), and residency1 fails
metadata validation. HTTP is repeatable; source serving/finalization was not
changed by SEC9, but inherited status was NOT proven. No disclosure was observed.
Ticket `issues/20261023-snapback4-one-view-http-retry-refused.md`. The CLI unit
flake is `issues/20261023-snapback4-owner-drop-reopen-unit-flake.md`; ownership
belongs to the integrated committer lane. These are recorded rather than hidden
by weakening tests or changing the other lane's code.

An initial client-pool attempt used a copied CLI outside the repository and
failed ancestor-based tool discovery; it was superseded by the complete normal
pool. Its7762pass/71fail result is not attributed to product regressions. The
final normal pool, model pool and wrapper pool completed; final commits restore
a clean git status after those executions.

Linux did build the musl binary and prove ELF/help plus installed Day2,DX4/DX5/
DX6,Expo upgrades,Day4,release transitions and dormant behavior before the Day5
blocker. Exact safe proof JSON and fresh client/expo tarball hashes are retained
in final-evidence/linux-incomplete; this directory is explicitly NOT a release
receipt. No Mac, publication, version change or push occurred.

## Remaining boundaries and cleanup

The language closes the declared write/freeze shapes; check/deploy refuses the
specified undecided shapes and actual replayed contradictions. It does not
infer every unstated application policy. Finite bounded search retains explicit
uncovered paths (actor/argument/frontier/work limits, some temporal payload-only
histories and unsupported reduction shapes). Thus an unconditional “zero holes
in arbitrary apps” claim is not justified, and is not made here.

The26GB worktree target directory, both owned Linux qualification scratch
directories, copied client executable directory and the exact owned failed
ownership-test scratch directory were removed after evidence collection. Source dependencies and small useful generated assets remain; no
other worktree or shared evidence lane was altered. All final logs/provenance are
committed; git status is checked clean after the client pools. No push.
