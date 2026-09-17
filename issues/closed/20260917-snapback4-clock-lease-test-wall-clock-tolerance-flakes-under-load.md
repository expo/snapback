# Snapback 4: the clock lease test's 5 ms wall-clock tolerance flakes under load

**Priority:** P3
**Status:** Closed (2026-09-17, fixed with the device diet's S5 landing)
**Date:** 2026-09-17
**Scope:** `snapback4/crates/snapback4/tests/clock.rs`, `clock_advance_preserves_a_live_action_claim_session_and_settlement`

The assertion at line 326 — "a refused lease transaction must not advance the
clock" — compares two intervals measured by different clocks over HTTP:

```rust
let before = host.query("time").as_i64().unwrap();   // server time, one HTTP round trip
let wall = snapback4_core::now_ms();                  // test wall clock, captured AFTER it
// ... a refused `/dev/clock/advance` of 120 s ...
assert!(host.query("time").as_i64().unwrap() - before <= snapback4_core::now_ms() - wall + 5, ..);
```

The server interval starts before the wall interval by however long the
first round trip's reply took to reach the test, and the tolerance is 5 ms.
On a loaded machine that gap exceeds 5 ms and the test fails although the
clock did not advance.

Measured 2026-09-17 on a machine at load 15–75: at the exact base commit
`70a663c22` the test alone failed 2 runs of 3; on the retained-read
composition branch it failed 2 of 3 alone and in both full-suite runs. It
passed in the base's one full-suite run. It is not related to either change.

The property under test is that a REFUSED advance of 120 s leaves the clock
alone. Assert that, not a 5 ms race: capture `wall` before `before`, or
require the server interval to be far below the refused 120,000 ms (for
example under 60,000 ms), which a wrongly applied advance cannot satisfy and
no plausible scheduling delay can violate.

## 2026-09-17 — resolution (S5 review round 1)

Captured the wall clock before the first server-time read and replaced the
5 ms comparison of unequal HTTP intervals with the property under test:
the server interval after a refused 120,000 ms advance must remain below
60,000 ms. The assertion reports both intervals if it fails. The successful
retry still asserts the exact 120,000 ms deadline shifts; neither the host
clock nor lease behavior changed.

From `snapback4/`, `cargo test -p snapback4 --test clock` passed five consecutive
runs, each `17 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out`
(11.53 s, 11.24 s, 11.33 s, 11.12 s, 11.11 s). Logs are
`/tmp/s5-r1-evidence/clock-{1,2,3,4,5}.log`. The worktree base is
`3d1c38c21f786c2795a92b87426d84a3b67dd2f0` (the metrics-only child of
`57bdc2cbcc`). The lead's prior failure evidence at `70a663c22` remains the
red-before evidence above; it was not rerun in this lane. Ready for the lead
to move this ticket to `issues/closed/` with the landing.

## 2026-09-17 — final form (S5 review round 2)

The second review round found the fixed 60,000 ms threshold still depends on
scheduling: two near-timeout HTTP phases can exceed it without any advance.
The landed assertion uses nested intervals instead. The test reads its own
clock, then the server's, runs the refused advance, reads the server's again
and then its own: the server interval lies inside the test's interval, so
`elapsed <= bracket + 50` holds under any load, and `bracket < 100_000` keeps
an applied 120,000 ms advance from hiding inside a stalled run. Three
consecutive runs passed on a machine at load 19–34.
