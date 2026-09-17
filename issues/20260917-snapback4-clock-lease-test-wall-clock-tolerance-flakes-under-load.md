# Snapback 4: the clock lease test's 5 ms wall-clock tolerance flakes under load

**Priority:** P3
**Status:** Open
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
