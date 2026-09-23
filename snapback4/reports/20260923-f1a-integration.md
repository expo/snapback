# F1a integration onto main — 2026-09-23

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
