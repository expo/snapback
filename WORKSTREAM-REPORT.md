# SEC13 workstream report

Implemented all three requested feature items on `sb4-b33-sec13`, based on
0681306baa. Merged origin/main 98177aa48b in fe69e628b2; no sibling security
streams merged, no push, no version bump. Added the commissioned 0.4.44 changes
entry. Linux only; Mac skipped. Evidence is under `snapback4/reports/sec13/`;
raw original runs remain under `/home/ccheever/sb4-loop/reports/sec13/`.

Acceptance is partial: six calibrated shapes caught, five safe controls quiet,
800 source-identical schemas have unchanged gates/exits. Final formatter replay
meets median 3 / p90 6 lines. SEC11L latency acceptance remains unqualified;
see the open latency ticket. This is not an all-bars-green handoff.

## Item 1: required evidence

Optional media and missing child evidence become default witnessed questions,
using SEC11 item 1's nonblocking class. Replays include parent creation and
existing transitions. Effect-free lowered boolean branches are supported;
opaque effects, loops and branch writes remain uncovered. Acknowledgments for
these families require a current evaluable witness; unsupported or legacy
unwitnessed findings cannot be closed, and invalid batches publish nothing.

Actual 004 room photo, 017 agreement, and 033 creation/acceptance without child
photo are caught. Required argument / atomic child insertion controls stay
quiet. Witnesses are executable examples, not assertions of inferred policy.

## Item 2: movable and wrong event-time anchors

`N_MOVABLE_TIME_ANCHOR` names the measured stored timestamp and editing
operation. A surviving net timestamp movement must commit; same-value updates,
A→B→A atomic restoration, and unrelated/deleted writes do not witness it.
`N_EVENT_TIME_ANCHOR` asks about a guard using clock time where an operation's
stored event time produces a different outcome. It requires the actual clock
comparison to pass, substituted event comparison to fail, and the selected
stored value to survive commit. Repairing old invalid state is not a witness.

Bounded operation-specific argument proposals reach the real 025 event/fee
combination. The existing eight-tuple / 8192-work limits remain; no arbitrary
seed rewriting. Partial point evaluation only accepts concrete non-null unique
pins and exact typed tables. Population, ambiguous and unsupported reads remain
unknown. Safe immutable original anchors and event-based guards stay quiet.

## Item 3: fixtures, output, documentation and review

Five exact wave-32 source copies plus SHA manifest cover six findings (004 has
two); originals were read-only. Safe variants are in replay tests and the
retained qualification tool. Default native actual outputs: 004 6 lines, 017 3,
025 6, 029 3, 033 4; safe variants 4/2/5/2/2. All exit 0 and carry evaluable
nonblocking questions only on actual cases.

All default witnessed cards now occupy one complete line, preserving ID,
summary, witness, command and answer template. JSON/review/gates are unchanged.
Guide text is a separate SEC13 section with dedicated recovery definitions.
Packed consumers resolve both new codes with installed `why`.

Design/amendment review used the exact requested Muse command and fresh Codex
session. Rounds 1–3 found precision issues fixed before round 4; both round 4
source reviews are READY. Both round 5 display reviews are READY. Verbatim
responses/provenance are under `llp/reviews/3000.036.004.001-sec13-*`.

## Verification and qualifications

- Setup: frozen Bun install, native/wasm/SDK builds pass. Wasm gzip 738613 bytes
  against 739113 budget. Package versions remain 0.4.43; only 0.4.44 entry added.
- SEC11 check-only survey: 800 identical source hashes; no gate changes, exit
  changes or remaining tool failures. Two baseline timeouts reran under an
  extended outer watchdog with unchanged campaign budget; originals retained.
  Selected witnessed counts: child 289, optional 84, movable 14, event 6.
- Semantic native output median 3/p90 8 vs baseline 3/7. Final Rust formatter
  replay of every captured card gives projected median 3/p90 6; this is a
  renderer composition, not a newly measured final-native 800 run. Actual
  ten-case native output independently passes. No truncation or hidden cards.
- Decision tests 28/28; CLI integration targets dx11, dx11_refusals, dx13,
  security_reviews, security_wave19: 32/32. Full guide retry 128/128 after
  correcting missing dedicated code definitions in the original 126/128 run.
- Installed consumer six-file first pass: 16/17 tests, with only the new wrong
  assertion expecting exit 1 rather than correct usage exit 2. Corrected packed
  security retry: 3/3. The other five files had passed. Final scoped run pending
  below; raw failed runs are not labeled PASS.
- Differential `run` seed 0 / 2k: zero disagreements. `run-lean` 2k: 1658 passed,
  324 unsupported, 18 disagreements, matching inherited SEC11 signatures/counts:
  continuation-next 5, next 8, prelude E_RULE/NOT_FOUND 5. Not a clean Lean PASS.
- Diagnostics registry check, docs budget, packaged-doc lint and ref-check pass
  in earlier affected verification. Root inventories was attempted and fails
  Snapback1's missing root deps/generated artifacts outside the Snapback4 fence;
  not bootstrapped or relabeled successful. No full battery / 20k / qualify-linux.
- Canonical affected plan selects seven crates and 446 clients despite the brief
  prohibiting full pools. The retained scope runner discloses omissions and
  preserves original/scoped plans. Full language semantic tests run at 8dbe;
  later presentation/recovery-only deltas use affected retests and unchanged
  semantic evidence under LLP 0189 / 0232. Obsolete duplicate runs are retained,
  not successful receipts. See the inherited affected-selector ticket.

## Latency deferral

Source-identical cold-50 review/deploy runs use one worker and fresh copies.
Review p90 baseline 37.489s → SEC13 43.277s; deploy 61.667s → 55.841s. Shared
host peak load/CPU 0.869/0.941. Launch/main do not include SEC11L's parallel
campaign/cache changes, so these fail to establish the requested no-regression
bar against SEC11L (historical p90 8.332/7.528s). No claim is made that latency
passed. Integration must bring the performance stream and rerun its unloaded
paired protocol; ticket `issues/20261027-snapback4-sec13-latency-qualification.md`.
No performance stream was merged or reimplemented outside ownership.

## Commits

104ffc70c2 design; 81ad08ea24 implementation/fixtures; fe69e628b2 main merge;
54e4937297 event focal value; 7db9abe468 time question rank; b02de37194 scope;
b58aceaf18 atomic restoration/event repair; 8dbe6d517c source approvals;
5c83b23a80 one-line cards; 36fd0efbf7 corpus replay; 70a39d4a83 code recovery;
ecf2559364 packed why/display reviews; 13fe26528f usage-refusal expectation.
All authored commits use Charlie Cheever / ccheever@firewoodagent.com.

## Final affected result

Pending final clean-commit scoped run; receipt will be recorded here.
