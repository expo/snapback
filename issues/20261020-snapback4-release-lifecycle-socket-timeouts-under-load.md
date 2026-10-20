# snapback4: release-lifecycle host tests time out on first runs under load

**Opened:** 2026-10-20
**Area:** `snapback4/crates/snapback4` host tests (release lifecycle / intake-switch group)

Two store-port lanes (P0-S4a and P0-S4c, LLP 3000.009.001.000 §3.3) saw two or three socket
timeouts (`WouldBlock` on a three-second read timeout) on their first full host-test run, on the
Hetzner builders while other builds ran. The failures did not reproduce on an untouched base
worktree or on a full rerun of the same binary. Both lanes' blind reviews (Sol and Grok) found
nothing in the diffs that touches sockets, read timeouts, the release gate or serve intake.

Tests named in the reports:

- `following_reply_stamps_the_engine_selected_after_request_intake`
- `authentication_and_metadata_stamp_the_engine_after_intake_switch`
- the action-admission test in the same group

**Hypothesis (unverified):** the three-second read timeout is tight while intake is paused across
activation on a loaded host.

**Next step:** reproduce under deliberate CPU load (for example `stress-ng` beside the test binary)
before changing the timeout. Record whether the bound is a product property or only a test-harness
choice.
