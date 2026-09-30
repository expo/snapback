## 2026-09-29 — Presence merge 2: preserve SR, LL, WD and KR

Merged origin/main 4226fc9733 into sb4/presence from 61cce6cbcb in the same
worktree after reading the four landed lane messages and journal entries.
Resolved all twelve conflicted files. The original branch journal remains an
exact byte prefix; main's added entries are appended without rewriting either
history. SR's DM routing, proposal recovery and current-member seen policy stay.
Its Send gate now uses existence: denied blocks, and absent blocks only when
fresh and not revalidating. Stale absent, partial and loading permit custody;
the server still authorizes each send. The client, social and offline cards,
starter README and LLP 3000.031 name that rule. The client card retains the
rules table and main's queued-read guidance at 1,198 words / 114 lines.

LL's held-read parking, resume at sync publication, ordinary server fallback,
terminal refusals, selective remembered-answer invalidation, queue timing and
publication/deadline fences stay. Every replacement recomputes existence;
retained empty answers reclassify when pending facts change. Process and wasm
regressions cover resumed absent-to-present and present-to-absent reads,
fallback replacement in both directions before sync, and terminal refusals
without the prior ready discriminant. A browser regression queues with a real
stale absent membership, then displays the server refusal at sync without a
re-invitation. Existing SR route and KR remount assertions remain intact.

Affected validation: 487 client checks passed, zero failures/cancellations/skips;
whole guide 105 passed; dev_refusals 21 passed. Preliminary checks found an
incorrect assertion that ignored pending-fact demotion, one omitted guide
sentence, and an initialization error in the admission-helper extraction;
all were corrected. The broad run with the startup error was interrupted and
then repeated completely. No existing assertion, deadline or count was weakened.

WD's shared maps, duplicate-key correction and build script are unchanged.
Same-worktree main and merged builds on the identical toolchain both measure
1,954,659 B raw / 581,329 B gzip with Binaryen, and 1,980,531 / 584,177 without
it: zero byte growth either way. Budget remains 593,719 B gzip, leaving 12,390
or 9,542 B respectively. Unoptimized sections are identical except the equally
sized data section (source-location metadata); no web instruction bytes changed.
Compared with this branch's pre-merge artifact, the selected build is 86,122 B
smaller raw and 11,587 B smaller gzip. Complete suite and final reference audit
follow this source checkpoint; their exact results will be appended below.

Work stayed in /Users/ccheever/projects/snapback-dm-20260927 with Node 24.18.0
selected explicitly and CARGO_INCREMENTAL=0, CARGO_PROFILE_TEST_DEBUG=0,
CARGO_PROFILE_DEV_DEBUG=0 exported. No push, stash, other worktree/machine or
spawned agent. Evidence: reports/20260929-presence-merge-2/; final report:
/Users/ccheever/projects/snapback-sb5-program/presence-merge-2.final.md.

Qualification follow-up: the first complete-suite attempt passed Rust and
reached 3,200 client passes without an assertion failure, then could not exit
the per-row React file because its browser bridge lost an earlier native-device
handle on reopening. The five tests had passed, but one native child remained.
Interrupted that owned run; it is not qualification evidence. The fixture now
routes calls by opening ID and retains every opening promise for teardown.
Its process case explicitly reloads the browser before the unchanged 1,000-row
write assertions. All five focused tests pass and the process exits normally
(13.970 s). No product semantics, assertion, count or deadline was relaxed.
The required complete suite will run again from the beginning.

Final complete qualification at 8c0a3dd10f (the merge plus only the fixture
teardown correction): with Node 24.18.0 explicitly selected and the three
Cargo variables exported, the required command was:

```sh
cd snapback4 && env -u FORCE_COLOR CARGO_INCREMENTAL=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_PROFILE_DEV_DEBUG=0 SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 bash scripts/test.sh
```

Exact result: `== 0 failure(s) in 4928 s`, exit 0. Rust passed in 809 s;
client tests passed 5,280 with zero failures/cancellations and nine inherited
optional external-fixture skips; final models passed all 79 in 199 s, with
both 5,000-seed session runs intact. The 33 inherited ignored Rust cases and
nine client skips are enumerated in the evidence. No skip was added.
The repaired per-row React file completed normally in this full run.
All 1,686 recorded product/test inputs stayed byte-identical during qualification.
The affected-scope corpus audit found no unresolved drift.

The complete run repeated `wasm 1954659 B raw, 581329 B gzip (budget 593719: ok)`.
The selected artifact hash is
751df32a7defddccb653acdd49bda0384d6c7092196b7756b4286dea64fe9381.
Final measure-wasm.sh at 2026-09-29T23:50:35Z records 8c0a3dd10f, dirty=false,
1,980,531 B raw / 584,177 B gzip / 444,177 B brotli, budget 593,719, over 0.
The budget is byte-identical to main; both matched build variants still show
zero growth, with 12,390 B selected / 9,542 B unoptimized gzip headroom.

Final `./ref-check --verbose`: `ref-check: ok — 525 LLP docs, 9955 refs in 29817 files, 0 errors, 0 unchecked`.
The merge, fixture correction and qualification evidence are committed on
sb4/presence. Nothing was pushed or published. The final report is exported
to /Users/ccheever/projects/snapback-sb5-program/presence-merge-2.final.md.
