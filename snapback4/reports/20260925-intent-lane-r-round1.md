# Lane R — round 1 review fixes

Date: 2026-09-25. Branch: `sb4-intent/r-minmax`.
Review base: `4b6d74f90`; original implementation and qualification are in
[`20260925-intent-lane-r.md`](20260925-intent-lane-r.md).

## Findings and changes

Astra's two Medium findings were reproduced before changing the implementation.
The focused suite then reported 16 passed / 2 failed: the maintained-point
overload refused compilation, and the JSON equality incorrectly completed
with 4 examined rows, 14 steps and only 1,104 heap bytes charged.
Grok's completed review reports the same Medium heap finding and one Low
test-strength finding. Both are addressed; there are no High findings.

| File | Change |
| --- | --- |
| `crates/snapback4-lang/src/bind/intent_aggregates.rs` | Recognize point-shaped arguments before choosing aggregate order. Complete maintained group lookups remain scalar totals; positional keys retain the binder's point/refusal path, and covered named unique keys remain points. Genuine domains retain extremum planning. |
| `crates/snapback4-core/src/engine/extrema.rs` | Reserve the selected value's full `heap_bytes()`, including shared map/row subtrees. Keep the exact reserved amount in the fold and release that amount when replacing its winner, leaving row scratch and other retained values charged. |
| `crates/snapback4-lang/tests/extrema.rs` | Add three regressions covering both binary operators on maintained points, retained JSON heap exhaustion, and repeated replacement of nested JSON winners. |
| `crates/snapback4-device/tests/extrema.rs` | Address Grok's Low finding: after reopening either device store, assert actual min/max/fallback data as well as completeness for complete, horizon-limited and online-only domains. |
| `reports/20260925-intent-lane-r-round1.md` | Record the reproductions, implementation, validation and remaining review status. |
| `JOURNAL.md` | Append the dated round 1 landing and measurements. |

No language form or diagnostic code was added. With a public source `t`,
`view totals: count t by .owner`, and `by byValue: value, id` on the view,
both existing binary calls compile and execute inside an outer shape:

```quarry
query low():
  return [{ value: 5 }] { n: min(totals[viewer], .value) }
query high():
  return [{ value: 5 }] { n: max(totals[viewer], .value) }
```

An empty group produces `0` / `5`; a group of seven produces `5` / `7`.
Named keys, an explicit `by byGroup`, compound group keys and a prior local
binding behave identically. Existing domain/page/list forms, including
`min(receipts where .message = m.id, .state) ?? 2`, retain their semantics.

## Regression evidence

- `binary_maintained_point_extrema_keep_their_scalar_overload`: checks both
  operators, one- and two-column group keys, positional/named/explicit/bound
  lookup spellings, and group counts 0, 3 and 7. It also asserts these
  programs contain no scans.
- `streamed_json_winners_exhaust_the_retained_heap`: the review's two
  2.5 MB JSON payloads and `min(witness, .payload) = max(witness, .payload)`
  exhaust the ordinary 16 MiB heap and return an unavailable null. At a
  test-only 18 MiB ceiling, either fold alone completes, but the equality
  exhausts heap after the first winner is already live. The test asserts
  the heap refusal and absence of a partial scalar.
- `replacing_a_json_winner_releases_its_full_retained_charge`: scan 128 JSON
  arrays containing shared map subtrees under a 64 KiB test ceiling. The
  minimum retains its first winner; the maximum replaces its winner on
  every row. Both finish, return the exact winner, and retain a charge at
  least as large as that winner's full payload.
- Existing memory/SQLite device tests now check all three operation values
  after reopening, so a correct completeness flag cannot hide an incorrect
  restored answer. This addresses Grok's Low finding as well as the
  requested High/Medium scope.

Focused validation: `cargo test -p snapback4-lang --test extrema --test guide`
passed 19 extrema tests and 80 guide tests, with no failures.
`cargo test -p snapback4-device --test extrema` passed both strengthened
device tests (2/2).

`bash scripts/build-wasm.sh` passed: **1,771,556 B raw / 493,764 B gzip**,
versus round 0's recorded 1,772,147 / 493,832 (−591 raw / −68 gzip).
This compares whole artifacts on the same toolchain; it does not attribute
independent subcomponents. The 494,000-byte gzip budget is unchanged, with
236 bytes of headroom. No runtime ceiling was changed.

## Final qualification

Final `scripts/test.sh`: **`== 0 failure(s) in 1136 s`**, exit 0.
All Rust targets and doctests passed. Client tests: 1,512 total,
1,502 passed, 10 existing skips, 0 failed. The final suite has no failures
to classify as ours, baseline or environmental.

Grok's file was checked before
the first attempt (progress notes only) and read in full when it finished.
Its Medium and Low findings are both addressed above.
The completed review and its `EXIT=0` marker were checked again immediately
before starting the final rerun.

The first suite attempt encountered one environmental Rust failure:
`snapback4::lifecycle::abort_profile_reports_an_off_thread_panic_to_redirected_stderr`.
Its standalone `rustc` invocation selected
`target/debug/deps/liblibc-54318865a2d8dc0f.rlib`, built with Rust 1.93.1,
while the pinned compiler is 1.97.0, and failed with `E0514`. This artifact
was timestamped during the running suite. The probe chooses the first
`liblibc-*.rlib` returned by `read_dir`; a mixed-toolchain cache reproduces
the problem. Quarantining only that incompatible `.rlib` and `.rmeta`
outside `target/debug/deps` made the isolated test pass (1/1, 1.50 s).
No product code or test assertion was changed for this failure. It is not
one of the supplied baseline log's recorded failures.
The first run's Rust stage finished with this single failure; its client
stage had no reported failure when stopped. Since that run also preceded
Grok's reopen assertions, it was interrupted with SIGTERM (exit 143) after
saving its logs; it has no `== … failure(s)` summary line. The full rerun
uses the corrected cache and all final test assertions.

Evidence is saved outside the worktree under `~/sb4-intent/`:
`lane-r-r1-test-final.log`, `lane-r-r1-rust-final.log`,
`lane-r-r1-focused.log`, `lane-r-r1-device.log`, `lane-r-r1-wasm.log`,
`lane-r-r1-extrema-before.log`, `lane-r-r1-lifecycle-control.log`, and
the interrupted attempt's `lane-r-r1-{test,rust,client}-attempt1.log`.

The suite uses the existing `SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1` switch,
`CARGO_INCREMENTAL=0`, `CARGO_BUILD_JOBS=16`, and this lane's existing
`/dev/shm` target/temp directories. These are build/test settings, not
product changes. Node 24.13 is the host version authorized in the brief.

## Decisions and scope

Planning uses a conservative structural classification before the binder's
type-based overload resolution. It never adds an aggregate order to an
unresolved positional point call. The binder still owns type errors and
ambiguity diagnostics. The fold stores its exact retention reservation,
rather than recomputing it from a cloned value whose capacity may differ.

No redesign, new refusal, guide prose change, runtime meter increase,
version change, push or publication. All four touched Rust files are
below 1,500 lines. No baseline failure was repaired in this round.
No Lane R review finding remains open. The standalone lifecycle probe's
selection of an arbitrary cached libc remains an environmental harness
limitation: the reproduction and local cache correction are recorded above.
