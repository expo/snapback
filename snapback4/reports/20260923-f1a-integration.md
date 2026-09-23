# F1a integration onto main — 2026-09-23

**Review round 2:** the follow-up to integrated `c7e40c4ac` is recorded at
the end of this report; the integration record below is historical.

Branch: `sb4-03/f1a-columns`. Integration base: `e91f60c7f` (`origin/main`
after `git fetch origin`). Original F1a commits: `40560fc56`, `61ae3b392`.
The worktree was clean before rebasing. No push, stash, LLP edit, or
`scripts/test.sh` execution.

## Governing context

Read-only `llp-orient`, within the Snapback 4 fence. LLP 3000 and
LLP 2000.000 provide the root and interpreter/device contract;
LLP 3000.007.001 §3.2, §3.7 and §3.11 cover field ownership, provisional
zero and load/adoption; LLP 3000.007.003 §3.2 and §3.3 cover recorded
attribution and timeline ownership. These are in `llp/current/`.
The current maintains card and main's READAUTH/F2 journal entries supply
the implemented surface. No design decision or LLP hand-off was needed.

## Rebase conflicts and resolutions

`git rebase origin/main` attempted to replay `3d6707a21`, the obsolete F2
first commit. It conflicted instead of being recognized as already applied.
Ran `git rebase --skip`, retaining main's final F2 implementation and both
fix rounds in full. All conflicts from that discarded replay were resolved
by dropping the entire obsolete commit:

- Core: `engine/mod.rs`, `engine/native.rs`, `engine/recorded.rs`,
  `engine/runner.rs`, `engine/write.rs`, `error.rs`, `rows.rs`, `schema.rs`.
- Device: `src/device.rs`, `src/device/history.rs`,
  `tests/maintains/recorded.rs`.
- Language: `bind/maintains.rs`, `bind/residency.rs`, `guide/codes.rs`,
  `guide/maintains.md`.
- Simulator: `tests/maintains_recorded.rs`.
- CLI: `src/verbs.rs`.

The implementation commit then had eight conflicted files. Paths in this
table are relative to `snapback4/crates/`.

| File | Resolution |
| --- | --- |
| `snapback4-core/src/engine/mod.rs` | Extend F2's existing `load_mode` selection to recognize maintained metadata, retaining the `mode` argument to `load_stored_rows`. Keep timeline import refusal in both import paths. Trusted restoration still preserves images; import strips/rebuilds maintained values and uses F2's capture/field refusal. |
| `snapback4-core/src/engine/runner.rs` | Keep `timeline_authority` and its initialization; add F1a's column prepayment/heap fields beside them. |
| `snapback4-core/src/engine/write.rs` | Wrap insert attempts in F1a's reservation while keeping the effect-aware engine-owned guard. Preserve timeline write refusal and purge charging; add private-column refusal and visible touched-table handling. Pass write origin into partition accounting while retaining main's `event_free` checks on every host. No parallel guard or authority was introduced. |
| `snapback4-core/src/error.rs` | Keep timeline refusal guidance and add maintained-column guidance as separate match arms. |
| `snapback4-core/src/schema.rs` | Initialize issues with the maintained-column dependency walk, then retain timeline validation and all existing schema checks. |
| `snapback4-device/tests/maintains/mod.rs` | Add only `mod columns`. F2's recorded tests now run through `tests/recorded_coverage.rs`; do not recreate the obsolete module registration. |
| `snapback4-lang/src/guide/maintains.md` | Keep F2's dotted-key examples and final import/capture wording, then append F1a's maintained-column section. |
| `snapback4-lang/tests/guide.rs` | Keep M7's `guide/feeds.rs` test module and append the maintained-column note-isolation test. |

Review-round commit `61ae3b392` replayed without conflict. `git range-diff`
marks its rebased form identical; implementation differences are the
resolutions above.

## Integration fixes and behavior

The first build found one new enum case: F1a's dependency walker did not
handle F2's `Constraint::Recorded`. It now recognizes that marker as having
no column dependency, like `AppendOnly`. The marker remains in the schema
and public projection, retaining the old-decoder fence.

The broad test build also found two direct constructors in main's timeline
unit fixtures missing F1a's new fields. `engine/maintains.rs` now supplies
`private: None`, and `engine/timeline_authority_tests.rs` supplies an empty
`maintained` map. These are test-only neutral defaults; the ownership
fixtures and their assertions are otherwise unchanged.

READAUTH's authoring census gained exactly one entry from F1a's new guide
example: `card/maintains/3:like | never`. Updated the expected census with
that entry; nothing was removed. The example is online-only, so it adds no
predicted private write site and needs no new `outcomes.rs` case. The
synced maintained-parent integration cases are covered by the two-store
regressions described below. READAUTH's 68 other tests passed on the first
broad run; the complete 69-test binary passed after updating the census.

Relative to the old F1a branch, provisional parent reads now obey main's
READAUTH: an unreadable predicted parent is hidden, including after a later
pending write changes its reader and after reopening the device. A parent
the predictor can read still exposes implicit zero with `pending: true`.
The maintains card now states this read-time condition. There is no change
to maintained-column derivation, server values, field ownership, load
semantics, or F1a's fresh-store activation boundary.

Two integration regressions in `tests/maintains/columns.rs` run on both
SQLite and memory. They cover readable/unreadable provisional parents,
point and indexed reads, pending reader changes and reopen; and the
projected `Recorded` marker/metadata plus capture prediction with no parent
aggregate prediction.

Main's F2 device recording and history implementations, READAUTH runtime,
timeline authority and owned schema, and M7's feeds card/retirement remain
unchanged. No new integration design conflict was found.

## Verification

All requested affected checks pass after the fixes above. Commands use Node 24.18.0, Rust 1.97.0,
wasm-bindgen 0.2.127 and two Rust test threads. The broad Rust test build
uses four Cargo jobs; the ordinary and WASM builds used two.
No `wasm-opt` is installed, matching the recorded main toolchain.

Commands, from `snapback4/`, with Node 24.18.0 on `PATH`:

```sh
CARGO_BUILD_JOBS=2 cargo build
CARGO_BUILD_JOBS=4 cargo test --no-fail-fast \
  -p snapback4-core -p snapback4-lang -p snapback4-device \
  -p snapback4-sim -p snapback4 \
  --features snapback4-core/postgres -- --test-threads=2
# Focused rerun after the census correction, preserving the same feature union:
CARGO_BUILD_JOBS=4 cargo test --no-fail-fast \
  -p snapback4-core -p snapback4-lang -p snapback4-device \
  -p snapback4-sim -p snapback4 \
  --features snapback4-core/postgres --test readauth -- --test-threads=2
CARGO_BUILD_JOBS=2 bash scripts/build-wasm.sh
bun run --cwd packages/snapback4 build
node --test --test-concurrency=1 packages/snapback4/test/maintained-columns.test.mjs
```

The initial combined Rust invocation was interrupted during compilation
to increase Cargo concurrency from two to four; the final invocation covers
the same complete requested scope. Before it finished compiling, the newly
built device test binary passed all five `maintains::columns::` tests,
including both integration regressions. These five are also in the broad
device suite, not additional distinct tests.

| Affected check | Final result |
| --- | --- |
| `cargo build` | PASS |
| Core, with Postgres admission checks | 197 passed; 9 database-dependent tests ignored. Includes all 18 corpus/adapter tests. |
| Language | 415 passed; 4 existing ignores. Includes 53 guide tests and all 36 maintained-column tests. |
| Device, SQLite and memory | 1,012 passed; 3 existing ignores. Includes the two new integration regressions, all 69 READAUTH tests and 12 F2 recorded-coverage tests. |
| Simulator | 524 passed; 4 existing ignores. Includes 19 recorded-attribution cases and native jobs/reads. |
| `snapback4` crate | 345 passed; 1 isolated latency-measurement test ignored. Includes timeline ownership, import/restore, delivery, and M7 retirement. |
| Package build | PASS |
| Maintained-column package tests | 2 passed, 0 skipped: SQLite process and actual rebuilt WASM. |
| Final WASM build | PASS: 468,600 B gzip against 469,000 B. |

Final distinct outcomes: **2,493 Rust tests + 2 package tests passed;
21 existing Rust ignores; no unresolved failures**. The complete Rust
invocation exited 101 because it ran the old census expectation before the
one-line correction. Its other targets passed; the entire affected
READAUTH binary then passed 69/69 with exit 0. The table replaces that
target's earlier 68-pass/1-failure outcome, without double-counting reruns.
The ignored cases are Postgres infrastructure, known analysis/presence
limitations, retained external calibration inputs, and explicit scale,
latency or native write-ceiling measurements. No Postgres runtime parity
claim is made for maintained columns.

Logs: `/tmp/f1a-integration-build.log`,
`/tmp/f1a-integration-rust-fixed.log`,
`/tmp/f1a-integration-readauth-verified.log`,
`/tmp/f1a-integration-device-columns.log`,
`/tmp/f1a-integration-package-build.log`,
`/tmp/f1a-integration-package.log`,
`/tmp/f1a-integration-wasm-verified.log`.
The distinct Rust totals are in `/tmp/f1a-integration-results.json`.
Earlier compile-error logs are `/tmp/f1a-integration-rust-final.log`;
the initial ratchet refusal is `/tmp/f1a-integration-wasm.log`.
`git diff --check` passes. All changed files are under 1,500 lines;
the largest is `crates/snapback4/tests/check.rs` at 1,436 lines.

## WASM

`bash scripts/build-wasm.sh`: **1,697,990 B raw / 468,600 B gzip**.
The first build failed the 466,000 B ratchet by 2,600 B. Raised
`metrics/wasm-budget.json` to **469,000 B**, with the measured attribution
in `why`; the second build returned the same bytes and passed, with 400 B
headroom.
The final rebuild after the test-fixture corrections returned the same
sizes and SHA-256 again.

Against main's recorded same-toolchain 1,684,353 B raw / 465,589 B gzip,
the delta is **+13,637 B raw / +3,011 B gzip**. This is F1a's whole-artifact
integration cost: maintained-column metadata and public projection,
implicit-zero materialization, field ownership, write-result stripping and
shared write/meter paths, alongside final F2, the timeline and READAUTH.
Private-total rebuild and SQLite import are server-only. These are not
independently measured component costs; main's baseline is the landing
measurement, not a second measurement in this worktree.

Source and package `dist` WASM have identical SHA-256:
`49863bf0064dd2687d07b399e6c8d546199d73cb9b3cbcd5677c671a2485a280`.
The passing web package test loads this rebuilt artifact.

The measured paragraph above is also the journal-ready landing reason.
The existing `JOURNAL.md` is 46,864 lines; it is left unchanged to respect
this task's under-1,500-lines constraint. The budget file, integration
commit message and this report carry the reason.

## Final commits

Final sequence above `e91f60c7f`, oldest first:

1. `783fc0ce5` — `feat(snapback4): maintained columns on a fresh store (F1a; LLP 3000.007.001)`; rebased `40560fc56` with the resolutions above.
2. `965d9dadb` — `fix(snapback4): review round 1 for maintained columns (F1a)`; unchanged replay of `61ae3b392`.
3. `sb4-03/f1a-columns` at completion (this report's commit) — `fix(snapback4): integrate F1a with final F2 and READAUTH`; marker handling, neutral timeline test defaults, integration regressions, guide/census update, ratchet and this report. Its concrete hash is included in the handoff response.

No old F2 commit remains in this branch's delta. No push was performed.

## Review round 2 — timeline authority

Base: `c7e40c4ac`, same branch and worktree. No commit, push, stash, rebase,
or `scripts/test.sh`. F1b's populated-store work remains separate.
Reviews read: `/Users/ccheever/sb4-03-lanes/f1a-columns/review-delta.md`
and `grok-delta-all.md` in the same directory.

The production fix is confined to maintained-column admission and mirroring.
`schema::columns::timeline_issues` rejects either a parent or source owned
or mapped by a timeline, using canonical `Timeline::owns/maps` rather than
trusting stored sets. Raw `schema::validate` includes these issues;
authoritative engine admission emits `E_MAINTAINED_COLUMN` and a rewrite
to ordinary tables outside the timeline or a separate maintain. The binder
checks after timeline declarations have been resolved. The mirror calls
`refuse_timeline_write(&owner.table, Effect::Update)` before the key and
parent lookup, including absent parents. It supplies no transition grant.

The governing constraints remain LLP 3000.007.001 §2 (ordinary tables),
§3.2 (private authority and mirrors), and LLP 3000.007.003 §3.3 (scoped
timeline authority). These are in `llp/current/`; no new design decision or
LLP hand-off is needed. The maintains guide and diagnostic entry now state
the timeline exclusion and clarify authorized provisional zero and preserved
server images. The journal records the earlier integration's WASM ratchet,
resolving the historical journal omission above; the budget is unchanged.

The raw regression checks all eight owned and all four mapped table roles,
as both parent and source, against a valid ordinary-table control. The
runtime regression installs hand-built state without engine validation:
direct mirrors refuse before lookup, an ordinary source insert reaches the
guarded mirror and refuses, rollback leaves source/private rows absent and
the parent unchanged, and a scoped transition is a positive control.
Binder regressions cover mapped parents, mapped sources and owned sources.

### Disposition of every numbered Grok finding

Packet 2 has no finding. Its unverified questions, and the other packets'
unverified comments, are not additional asserted defects.

| Finding | Disposition |
| --- | --- |
| 1.1 | Incorrect: `old == new && !dependency_changed && !lifetime_changed` already skips unchanged declarations; removal with populated source/private storage refuses, and activation deletes removed-table rows before reintroduction (`store/activation.rs`), so the proposed stale reattachment path does not exist. |
| 1.2 | Strengthened native dispatch to test both duplicate orders; raw rejection and both-order system reads already run separately in `maintained_columns_review.rs`. |
| 3.1 | Strengthened the device helper to reject `$column` throughout pages and queried row images, including reopen and forged-write controls. |
| 3.2 | Strengthened the optimistic like to require exactly `likes/l1` and all three parent values equal zero; the predicted identifiers carry no row payload. |
| 3.3 | Fixed the test's submission sequence to increase through changes, parent creation and unlike. |
| 3.4 | Strengthened pending-parent triples, matching mutation IDs, final empty outbox and reopen after delete-to-zero; read-authority coverage lives in the dedicated both-store test. |
| 4.1 | Added an immediate post-hide read, the exact predicted path and an unaffected readable pending control that remains the sole authorized row after reopen. |
| 4.2 | Incorrect contract: `public_page` is an assertion, not a stripping transform; nonzero public parent mirrors must be delivered, and the existing run/oracle tests verify them. |
| 4.3 | Added raw predicted capture checks and forged insert/update refusals; `= null` really selects the captured null (the server attribution test asserts selected=1), and device open has no `LoadMode` argument. |
| 5.1 | Added a whole-projection target-string check; the existing precise `E_MAINTAINED_COLUMN_PRIVATE` assertion cannot be satisfied by an ordinary rule denial. |
| 5.2 | Added a check over every raw validation issue, in addition to the engine-error check; `ColumnOwner::target` fixes the actual `$column:` prefix. |
| 5.3 | The proposed legal-expiry fixture is impossible for the closed private shape: its only fields are id, parent reference and numeric value; time fields are extra and refused. Tightened projection rejection to require the missing-derivation reason and no private target. |
| 6.1 (High) | Incorrect: Rust 1.97.0 compiles and runs `i64::from(true/false)` as 1/0; retained the original expression and ran the real creator test. |
| 6.2 | Added unconditional wire reply/receipt/table privacy checks and explicit sent/default versus failed/cut assertions. |
| 6.3 | Incorrect oracle criticism: `selected` is a filtered count, `total` the sum; predicate discrimination is already exercised with inactive rows and distinct amounts by `oracle_moves_filters_sums_birth_and_last_delete`, while this test isolates hidden-total disclosure. |
| 6.4 | Expanded refusal rollback snapshots to every physical table, including sources/private totals; trusted restore semantics are covered separately. |
| 6.5 | Expanded dependency and raw rule cases to every maintained field and require exactly one disclosure note per owning column. |
| 6.6 | Added nonempty maintain cardinality and explicit public-table sync assertions before checking private targets remain unsynced. |
| 7.1 | Added stored captures/private totals before and after deletion/recreation, replacement parent identity/liveness and the uncredited other-parent control; `seed_at` is the guarded seed write path, not inert image assignment. |
| 7.2 | Added visible event-table checks, exact private-target exclusions and exactly one parent event, preserving the full image oracle. |
| 8.1 | Incorrect remove/re-add scenario for the same reasons as 1.1; the guide already states both the populated-source/private restriction and the fresh-store remedy. |
| 8.2 | Clarified that unreadable provisional parents stay hidden, implicit zero follows authorization and acknowledgements do not clear synchronized values. |
| 9.1 (High) | Fixed: restore supplies one matching private image for every parent field and asserts every image; import independently recounts all three private totals and rescans touched metadata. |
| 9.2 | Added raw source/private assertions after each write, verified the missing expiry field and effective expiry, and added an unchanged legal adoption control; the no-update trigger remains a hard physical-write witness. |
| 9.3 | Corrected the overstated test name: legacy validation intentionally accepts missing maintained fields, and constraints on those fields are forbidden; strengthened all write-result, zero-materialization and preserved-value triples. |
| 9.4 | Added the explicit empty-parent precondition before each source-only adoption refusal. |
| 10.1 | Incorrect requirement to erase failed compiler output: diagnostics and notes are separate, and engine admission independently refuses the invalid schema; added that refusal plus accepted-derivation presence controls. |
| 10.2 | Added exact maintain cardinality, parent metadata and `default` source assertions. |
| 11.1 | Added actual private-target checks over alice/bob streams and exact synced-delete event tables/count. |
| 11.2 | Added authoritative private-total assertions after successful writes in every parent world; `Store::rows` reads raw SQL images and includes expired rows. |
| 12.1 | Removed the ineffective file-creation-order loop; the fixture test now claims only the actual directory-loader path. |
| 12.2 | Added physical parent/private-total assertions and removed the unmeasured “once” claim. |
| 12.3 | Trusted Restore must preserve supplied values (9.1), so refusing them would violate the contract; strengthened all missing-field, stdout/SQL-payload and successful-output privacy checks and added an absent-table SQL control. |
| 13.1 | Appended the measured integration ratchet to the journal and replaced the budget's omission rationale with that pointer; no budget increase. |
| 14.1 | The pre-existing package test already samples `pending=true`; strengthened it to all three zeros, with unreadable/readable authorization and reopen checked on both stores in the dedicated Rust test. |
| 14.2 | Added query/watch privacy checks, retained pages asserted outside the fetch hook and one matching interrupted parent image; full-row equality is correct after confirmation, and sync limit=1 still delivers whole commits rather than exactly one event. |
| 14.3 | Added value bounds for every watch sample, exact empty data/why stdout and no SQL rows, and escaped the public-label regex; removed the ambiguous total-text regex. |

### Round-2 verification

The affected Rust command, run from `snapback4/`, is:

```sh
CARGO_BUILD_JOBS=4 cargo test --no-fail-fast -p snapback4-core -p snapback4-lang -p snapback4-device -p snapback4 --features snapback4-core/postgres -- --test-threads=2
```

Final distinct Rust results, incorporating the corrected clock-target rerun
described below:

| Crate | Passed | Existing ignored |
| --- | ---: | ---: |
| `snapback4-core`, including corpus | 199 | 9 |
| `snapback4-lang` | 416 | 4 |
| `snapback4-device`, including both stores | 1,012 | 3 |
| `snapback4` | 345 | 1 |
| **Total** | **1,972** | **17** |

The ignored cases are existing live-Postgres, isolated metrology, retained
calibration or documented limitation cases; this change adds no ignores.
All five maintained-column device cases passed on both stores. The creator
disclosure test (Grok 6.1), strengthened restore/import test (9.1), and new
binder regression passed. The focused authority suite separately passed
**5/5** (`/tmp/f1a-r2-authority.log`). Doc-test targets passed with zero cases.
Per-target initial results, corrected clock result and final distinct totals
are recorded in `/tmp/f1a-r2-results.json`.

The first broad run exposed an existing clock-test timing error:
`offset_cli_advance_and_rejected_inputs_keep_time_monotone` placed the wall
timestamp after its first server read, so scheduling that reply could make
the server interval longer than the measured wall interval. An exact retry
reproduced it. The test now starts its wall interval before both server reads,
retaining the same 5 ms allowance. The entire corrected clock target passed
**17/17**, using `cargo test -p snapback4 --features snapback4-core/postgres
--test clock -- --test-threads=1`. The initial broad command exited **101**
with this one failed target; it is not reported as a clean invocation.
Logs: `/tmp/f1a-r2-rust.log`,
`/tmp/f1a-r2-clock-retry.log`, `/tmp/f1a-r2-clock-fixed.log`.

`bash scripts/build-wasm.sh` passed at **1,697,990 B raw / 468,599 B gzip**,
under the unchanged **469,000 B** budget. `bun run --cwd packages/snapback4 build`
passed, and the strengthened maintained-column package test passed separately
on SQLite (**1/1**) and rebuilt web WASM (**1/1**), using Node 24.18.0.
Logs: `/tmp/f1a-r2-wasm.log`, `/tmp/f1a-r2-package-build.log`,
`/tmp/f1a-r2-package-sqlite.log`, `/tmp/f1a-r2-package-web.log`.
Source and package `dist` WASM have identical SHA-256:
`089e869e361a422f4928f36f189cad2626e0285abe0ea9875217ce48d0c3f04b`.

### Admission mutation proof

Used an isolated filesystem copy and separate Cargo target directory while
the main tests ran. In that copy, replaced `timeline_issues` with an empty
result, removing the shared admission rejection while retaining the runtime
mirror guard. Ran the exact raw regression:

```sh
cargo test -p snapback4-core -p snapback4 --features snapback4-core/postgres --lib engine::timeline_authority::write_tests::raw_columns_reject_timeline_owned_and_mapped_parents_and_sources -- --exact --test-threads=2
```

The mutated build compiled, then the regression **failed** at
`timeline_authority_tests.rs:54`: raw validation returned `[]` instead of a
timeline-parent refusal. Result: **0 passed, 1 failed**, exit **101**.
Restored the copy **byte for byte** from the saved original in a `finally`
block. The saved original, restored copy and actual worktree file all have
SHA-256 `8b07ea8cda81251aa898449ff6af97d40153551ce673738d02891e92ce6bde5e`.
The restored regression **passed (1/1, exit 0)**. Proof records and logs:
`/tmp/f1a-r2-mutation.json`, `/tmp/f1a-r2-mutation.log`,
`/tmp/f1a-r2-restored.log`; driver `/tmp/f1a-r2-mutation.py`.

Final `git diff --check` passed. HEAD remains `c7e40c4ac`; all round-2 edits
are uncommitted. No commit, push, stash or `scripts/test.sh` occurred.
