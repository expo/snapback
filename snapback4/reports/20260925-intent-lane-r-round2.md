# Lane R — round 2 review fixes

Date: 2026-09-25. Branch: `sb4-intent/r-minmax`. Review base: `b69632a75`.
Earlier implementation and findings remain recorded in the round 0 and
[`round 1 report`](20260925-intent-lane-r-round1.md).

## Findings and implementation

Addressed Grok's Medium admission-order finding and Astra's Low
replacement-test gap. Both reviewers confirm the round 0 findings are fixed.

| File | Change |
| --- | --- |
| `crates/snapback4-core/src/engine/read.rs` | After decoding, authorization and residual filtering, release this iteration's row/key scratch before the extremum fold admits its winner. Clear the scope so it cannot be released a second time. |
| `crates/snapback4-core/src/engine/extrema.rs` | Reuse the old winner's reservation: admit only `new_bytes.saturating_sub(old_bytes)`, then replace the value and release `old_bytes.saturating_sub(new_bytes)`. A failed admission leaves the old value and reservation intact. Drop the old owned value before cloning into its allowance. Full shared-subtree accounting remains in place. |
| `crates/snapback4-lang/tests/extrema.rs` | Add both large-JSON completion reproductions. Strengthen replacement tests with growing and shrinking nested JSON payloads for both operators, a heap ceiling and lower/upper final-charge assertions. |
| `reports/20260925-intent-lane-r-round2.md` | Record the implementation, tests, measurements, failures and decisions. |
| `JOURNAL.md` | Append one dated round 2 entry. |

No syntax or diagnostic changed. These existing forms now complete for the
review's large payloads, with Boolean output to stay within the independent
output-byte limit:

```quarry
query low():
  return min(witness, .payload) != null
query high():
  return max(witness, .payload) != null
```

The source is a public online-only table with `payload: json <=3000000`.
One row containing `{"big": "a" + "x" × 2500000}` fits the default 16 MiB
heap for either operator. Two rows starting with `a` and `b` fit the
test's 18 MiB heap while `max` replaces the winner. Before the fix, these
reproductions cut at **17,511,524** and **20,011,880** charged heap bytes.

## Tests and measurements

- `one_large_json_winner_fits_the_default_heap`: both min/max complete,
  examine one row and retain a charge covering the payload at the default
  16 MiB ceiling. Final heap: **2,500,676 bytes**.
- `replacing_a_large_json_winner_fits_eighteen_mib`: max must replace `a…`
  with `b…`; it completes under 18 MiB and examines two rows. Final heap:
  **2,500,676 bytes**.
- `replacing_a_json_winner_releases_its_full_retained_charge`: both min/max
  replace the winner on every one of 128 rows, with payload sizes either
  growing or shrinking independently of their comparison order. A 128 KiB
  test ceiling bounds the scan. The final charge must cover the winner
  and remain below its payload plus 4 KiB of bookkeeping. Growing runs
  retain **8,487 payload / 9,175 total heap bytes**; shrinking runs retain
  **359 / 1,047 bytes**. These bounds catch both undercharging and a leaked
  old reservation.
- The existing `streamed_json_winners_exhaust_the_retained_heap` still
  requires an unavailable result when a retained winner leaves insufficient
  space for a later fetch. Releasing scratch does not remove the retained
  winner's charge.

Mutation check: temporarily reverse the old/new subtraction when releasing
the reservation. The varying-size test fails with `winner undercharged`.
Restore the correct calculation before qualification; no mutation remains.

Focused validation after restoring the correct calculation: 21 extrema
tests and 80 guide tests passed.

`scripts/build-wasm.sh` passed: **1,771,743 bytes raw / 493,779 gzip**,
versus round 1's recorded 1,771,556 / 493,764 (**+187 raw / +15 gzip**).
These are whole-artifact measurements on the same toolchain, not independent
component attribution. Keep the 494,000-byte gzip budget, with 221 bytes
of headroom. Runtime ceilings are unchanged.

Final `scripts/test.sh`: **`== 0 failure(s) in 1249 s`**, exit 0.
All Rust targets and doctests passed, including 21 extrema tests, 80 guide
tests, both device extrema tests and all 20 lifecycle tests. Clients:
1,512 total, 1,502 passed, 10 existing skips, 0 failed. There are no final
suite failures to classify as ours, baseline or environmental.

The suite used `CARGO_INCREMENTAL=0`, `CARGO_BUILD_JOBS=16`,
`SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1`, and this lane's existing tmpfs
target/temp directories. Node 24.13 is the host version authorized by the
brief. Saved evidence under `~/sb4-intent/`:
`lane-r-r2-test-final.log`, `lane-r-r2-rust-final.log`,
`lane-r-r2-focused.log`, `lane-r-r2-extrema-before.log`,
`lane-r-r2-focused-first.log`, `lane-r-r2-wrong-release-mutation.log`,
and `lane-r-r2-wasm.log`.

## Failures encountered

- Initial test compilation: E0271 from an inferred `i32` payload index used
  as a `usize` string length. This was a test-authoring error in this round,
  corrected with an explicit `usize` annotation.
- Before the runtime fix: 18 extrema tests passed and 3 failed. Both large
  completion tests reproduced the reviewed defect. The varying-size test
  also exceeded its initial 64 KiB test ceiling.
- After the runtime fix, the two large cases passed, but the varying-size
  fixture's largest decode buffer plus its live winner still legitimately
  exceeded 64 KiB (65,645 bytes at 116 examined rows). Set that test's
  ceiling to 128 KiB, retaining the much tighter final-charge checks. No
  production ceiling changed. This was a test-bound error, not a remaining
  production defect.
- The deliberate wrong-release mutation failed its one selected test, as
  required, and was reverted.

## Decisions and scope

Early scratch release applies only to extrema: count/sum retain their
existing source-row allowances while evaluating projections. Authorization,
expiry handling and residual predicates still run before the release and
comparison. Rejected rows keep their normal scope cleanup. The fold keeps
the exact full-payload reservation and changes it only after growth is
admitted; it drops old owned bytes before cloning the replacement.

No design deviation, new refusal, guide rewrite, planner change, runtime
meter increase, version change, push or publication. The test-only ceiling
adjustment above admits the deliberately larger fixture. All touched Rust
files remain below 1,500 lines. No baseline failure was repaired.

No round 2 review finding remains open. The environmental lifecycle-probe
limitation recorded in round 1 is unchanged: selecting a Rust 1.93.1 libc
rlib from a mixed `target/debug/deps` cache while invoking Rust 1.97.0 can
reproduce E0514. This round used the corrected cache, encountered no such
failure, and passed the whole lifecycle target.
